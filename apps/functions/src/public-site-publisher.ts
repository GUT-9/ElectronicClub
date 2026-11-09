import { createHash, randomUUID } from 'node:crypto'
import type { ClubArticle, PopupAnnouncement, ForumBoard, ForumPostView, ForumCommentView, ForumAuthor } from '@electronic-club/shared'
import { PUBLIC_SITE_KEY, PUBLIC_SITE_MAX_BYTES } from '@electronic-club/shared/public-site'
import type { PublicSite, PublicAsset } from '@electronic-club/shared/public-site'
import type { Store, Transaction } from './members/store'
import type { StageResult } from './stage3/service'
import { inspectImage } from './forum/images'
import { resourceView } from './resources/model'
import type { ResourceRecord } from './resources/model'
import type { ResourceProvider } from './resources/qiniu'
import { QiniuProvider } from './resources/qiniu'
import type { PublicSiteStorage } from './public-site-storage'
import { QiniuPublicSiteStorage } from './public-site-storage'
import { popupVersion, scheduledPopup } from './public-site-timed'
import type { TimedSite } from './public-site-timed'
import type { MediaImage } from './media/model'

type Export = Record<string, Record<string, unknown>[]>
type State = { requested: number; published: number; dirty: boolean; owner: string | null; until: number; generatedAt?: string; pendingAssets?: number; cleanupPending?: number }
type AssetRecord = { id: string; path: string; asset: PublicAsset; status: 'pending' | 'ready' | 'deleting' }
const stateKey = 'public-site:publisher'
export async function markPublicDirty(tx: Transaction) {
  const state = await tx.get<State>('system', stateKey) ?? { requested: 0, published: 0, dirty: true, owner: null, until: 0 }
  await tx.set('system', stateKey, { ...state, requested: state.requested + 1, dirty: true })
}
export function changesPublicContent(path: string) {
  if (/^\/api\/(articles|popups)(?:\/|$)/.test(path)) return true
  if (/^\/api\/events(?:\/|$)/.test(path)) return !/\/checkin$/.test(path)
  if (/^\/api\/forum\/(boards|posts|comments)(?:\/|$)/.test(path)) return !/\/(favorite|view)$/.test(path)
  if (/^\/api\/resources\/[a-f0-9-]{36}\/(update|delete)$/.test(path)) return true
  return path === '/api/profile' || /^\/api\/members\/[^/]+(?:\/(restore|delete|purge|anonymize))?$/.test(path)
}
// Whitelists keep future private DB fields out of publicly readable objects.
function pick<T>(raw: Record<string, unknown>, keys: string[]): T {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(raw, key)).map((key) => [key, raw[key]])) as T
}
const contentKeys = ['id','title','summary','content','cover','status','publishedAt','createdAt','updatedAt','publisherUid','publisherName']
const boardKeys = ['id','name','description','position','status','requireReview','createdAt','updatedAt']
const postKeys = ['id','boardId','authorUid','title','body','imageIds','status','pinned','featured','locked','commentsClosed','viewCount','likeCount','commentCount','commentSequence','lastReplyAt','createdAt','updatedAt']
const commentKeys = ['id','postId','authorUid','parentId','body','status','floor','createdAt','updatedAt']

export class PublicSitePublisher {
  constructor(
    private store: Store,
    private readImage: (path: string) => Promise<StageResult>,
    private storage: PublicSiteStorage = new QiniuPublicSiteStorage(),
    private resources: ResourceProvider = new QiniuProvider(),
    private clock = () => Date.now(),
  ) {}
  async status() {
    const state = await this.store.read<State>('system', stateKey)
    const price = Number(process.env.PG_POINTS_PER_CORE_SECOND)
    return { configured: this.storage.configured(), mode: process.env.PUBLIC_SITE_MODE === 'qiniu' ? 'qiniu' : 'database',
      origin: this.storage.configured() ? this.storage.origin() : '', target: 1500, reserve: 300,
      pointPrice: Number.isFinite(price) && price > 0 ? price : null,
      dirty: state?.dirty ?? true, generatedAt: state?.generatedAt ?? null,
      requested: state?.requested ?? 0, published: state?.published ?? 0,
      pendingAssets: state?.pendingAssets ?? 0, garbage: state?.cleanupPending ?? 0 }
  }
  private async lease(tx: Transaction, owner: string) {
    const state = await tx.get<State>('system', stateKey)
    if (state?.owner !== owner || this.clock() + 10_000 >= state.until) throw Error('PUBLIC_LEASE_EXPIRED')
    return state
  }
  async sync(): Promise<'ready' | 'pending' | 'failed'> {
    const configured = this.storage.configured(), owner = randomUUID(), deadline = this.clock() + 40_000
    const claimed = await this.store.run(async (tx) => {
      const state = await tx.get<State>('system', stateKey) ?? { requested: 0, published: 0, dirty: true, owner: null, until: 0 }
      state.requested++
      state.dirty = true
      const available = configured && (!state.owner || state.until <= this.clock())
      if (available) { state.owner = owner; state.until = this.clock() + 60_000 }
      await tx.set('system', stateKey, state)
      return available
    })
    if (!configured) return 'failed'
    if (!claimed) return 'pending'
    try {
      for (let attempt = 0; attempt < 2 && this.clock() < deadline; attempt++) {
        const state = await this.store.run((tx) => this.lease(tx, owner))
        const { snapshot, records, paths, pending, timed } = await this.build(deadline, owner)
        const bytes = Buffer.from(JSON.stringify(snapshot))
        if (bytes.length > PUBLIC_SITE_MAX_BYTES) throw Error('PUBLIC_SITE_TOO_LARGE')
        await this.store.run((tx) => this.lease(tx, owner))
        await this.storage.putTimed(timed)
        await this.storage.put(PUBLIC_SITE_KEY, bytes, 'application/json')
        // The manifest changes first. Revoked content disappears even if cleanup
        // or one new image upload needs a retry. Asset progress uses small rows,
        // never a growing array that can exceed the 64KiB RPC body budget.
        const inUse = new Set(Object.values(snapshot.assets).map((v) => v.key))
        const obsolete = records.filter((v) => !paths.has(v.path))
        let cleanupPending = obsolete.length
        for (const record of obsolete) {
          if (this.clock() >= deadline) break
          try {
            await this.store.run(async (tx) => {
              await this.lease(tx, owner)
              await tx.set('system', record.id, { ...record, status: 'deleting' })
            })
            if (!inUse.has(record.asset.key)) await this.storage.remove(record.asset.key)
            await this.store.run(async (tx) => { await this.lease(tx, owner); await tx.remove('system', record.id) })
            cleanupPending--
          } catch { break }
        }
        const settled = await this.store.run(async (tx) => {
          const current = await this.lease(tx, owner)
          const dirty = current.requested !== state.requested || pending > 0
          await tx.set('system', stateKey, { ...current, published: state.requested, dirty, pendingAssets: pending, cleanupPending,
            generatedAt: snapshot.generatedAt, owner: dirty ? owner : null, until: dirty ? current.until : 0 })
          return !dirty
        })
        if (settled) return 'ready'
      }
      return 'pending'
    } catch {
      console.error(JSON.stringify({ category: 'public_sync', code: 'PUBLIC_SYNC_FAILED' }))
      return 'failed'
    } finally {
      await this.store.run(async (tx) => {
        const state = await tx.get<State>('system', stateKey)
        if (state?.owner === owner) await tx.set('system', stateKey, { ...state, owner: null, until: 0 })
      })
    }
  }
  private async build(deadline: number, owner: string) {
    const raw = (await this.store.list<Export>('public_site_export', {}, { offset: 0, limit: 1 })).items[0]!
    const authors = (raw.authors ?? []).map((v) => {
      const author = pick<ForumAuthor>(v, ['uid','nickname','avatar'])
      if (!/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(author.avatar ?? '')) author.avatar = ''
      return author
    })
    const author = (id: string) => authors.find((v) => v.uid === id) ?? { uid: id, nickname: '已注销成员', avatar: '' }
    const boards = raw.boards!.map((v) => pick<ForumBoard>(v, boardKeys))
    const posts = raw.posts!.map((v) => {
      const post = pick<ForumPostView>(v, postKeys)
      return { ...post, author: author(post.authorUid), board: boards.find((b) => b.id === post.boardId)! }
    })
    const comments = raw.comments!.map((v) => {
      const comment = pick<ForumCommentView>(v, commentKeys)
      return comment.status === 'deleted' ? { ...comment, authorUid: '', body: '该评论已删除', author: { uid: '', nickname: '', avatar: '' } } :
        { ...comment, author: author(comment.authorUid), parent: v.parent ? pick(v.parent as Record<string, unknown>, ['id','floor','nickname']) : null }
    }) as ForumCommentView[]
    const snapshot: PublicSite = {
      format: 'eclub-public-v1', revision: randomUUID(), generatedAt: new Date(this.clock()).toISOString(),
      events: raw.events!.map((v) => pick(v, [...contentKeys,'location','startsAt','endsAt','registrationEnabled','registrationStartsAt','registrationDeadline','capacity','allowCancellation','approvalRequired','notesEnabled','notesRequired','checkinEnabled','checkinOpen','occupied'])),
      articles: raw.articles!.map((v) => pick<ClubArticle>(v, [...contentKeys,'category','pinned'])),
      popups: [],
      boards, posts, comments, assets: {},
      resources: raw.resources!.map((v) => ({ ...resourceView(v as unknown as ResourceRecord), downloadUrl: this.resources.download(v as unknown as ResourceRecord) })),
    }
    // Scheduled announcements are encrypted with the existing server-only Qiniu
    // key. Future titles/images must never be exposed in a public JSON object.
    let previousTimed: TimedSite | null = null
    try { previousTimed = await this.storage.timed() } catch { /* Rebuild from trusted SQL after key rotation/corruption. */ }
    const popups = raw.popups!.map((v) => pick<PopupAnnouncement>(v, ['id','version','title','summary','image','buttonText','targetType','targetId','startsAt','expiresAt','priority','enabled','state','createdAt','updatedAt']))
    const retired = previousTimed ? scheduledPopup(previousTimed, this.clock()).retired : []
    const timed: TimedSite = { popups, retired: retired.filter((version) => popups.some((p) => popupVersion(p) === version)), assets: {} }
    for (const entry of (raw.timedMedia ?? []) as unknown as { id: string; popupIds: string[] }[]) {
      if (this.clock() >= deadline - 10_000) throw Error('PUBLIC_TIMED_TIME_BUDGET')
      const path = '/api/media/' + entry.id
      const old = previousTimed?.assets[path]
      if (old) { timed.assets[path] = { ...old, popupIds: entry.popupIds }; continue }
      const image = await this.store.run(async (tx) => {
        const record = await tx.get<MediaImage>('media_images', entry.id)
        if (!record || record.status !== 'ready' || record.bytes > 51200 || record.chunkCount > 3 ||
            !record.bindings.some((b) => b.kind === 'popup_announcements' && entry.popupIds.includes(b.id))) throw Error('PUBLIC_TIMED_IMAGE')
        const chunks = await Promise.all(Array.from({ length: record.chunkCount }, (_, n) => tx.get<{ data: string }>('media_chunks', `${entry.id}:${n}`)))
        const bytes = Buffer.concat(chunks.map((v) => Buffer.from(v?.data ?? '', 'base64')))
        if (bytes.length !== record.bytes) throw Error('PUBLIC_TIMED_IMAGE_SIZE')
        const checked = inspectImage(`data:${record.mime};base64,${bytes.toString('base64')}`, 51200)
        return { mime: checked.mime, base64: bytes.toString('base64'), popupIds: entry.popupIds }
      })
      timed.assets[path] = image
    }
    snapshot.hasTimedPopups = popups.length > 0
    const records = (raw.copiedAssets ?? []) as unknown as AssetRecord[]
    const paths = new Set([
      ...(raw.mediaIds as unknown as string[]).map((id) => '/api/media/' + id),
      ...(raw.forumImageIds as unknown as string[]).map((id) => '/api/forum/images/' + id),
    ])
    if (paths.size > 640) throw Error('PUBLIC_ASSET_QUOTA')
    const missing: string[] = []
    for (const path of paths) {
      const ready = records.find((v) => v.path === path && v.status === 'ready')
      if (ready) snapshot.assets[path] = ready.asset
      else missing.push(path)
    }
    for (let start = 0; start < missing.length && this.clock() < deadline - 10_000; start += 3) {
      await Promise.allSettled(missing.slice(start, start + 3).map(async (path) => {
        const image = await this.readImage(path)
        if (!image.binary || !['image/jpeg','image/png','image/webp'].includes(image.contentType ?? '')) throw Error('PUBLIC_ASSET_MISSING')
        const inspected = inspectImage(`data:${image.contentType};base64,${image.binary.toString('base64')}`, 51200)
        const ext = inspected.mime === 'image/jpeg' ? 'jpg' : inspected.mime.slice('image/'.length)
        const record: AssetRecord = { id: 'public-site:asset:' + path, path, status: 'pending',
          asset: { key: `electronicclub/public-site/v1/assets/${createHash('sha256').update(image.binary).digest('hex')}.${ext}`, mime: inspected.mime, bytes: image.binary.length } }
        await this.store.run(async (tx) => { await this.lease(tx, owner); await tx.set('system', record.id, record) })
        await this.storage.put(record.asset.key, image.binary, record.asset.mime)
        record.status = 'ready'
        await this.store.run(async (tx) => { await this.lease(tx, owner); await tx.set('system', record.id, record) })
        snapshot.assets[path] = record.asset
      }))
    }
    if (Object.values(snapshot.assets).reduce((sum, v) => sum + v.bytes, 0) > 33554432) throw Error('PUBLIC_ASSET_BUDGET')
    snapshot.timedMediaIds = Object.keys(timed.assets).filter((path) => !snapshot.assets[path]).map((path) => path.split('/').pop()!)
    return { snapshot, records, paths, pending: paths.size - Object.keys(snapshot.assets).length, timed }
  }
}
