import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PUBLIC_SITE_KEY } from '@electronic-club/shared/public-site'
import type { PublicSite, PublicAsset } from '@electronic-club/shared/public-site'
import type { PublicSiteStorage } from '../../apps/functions/src/public-site-storage'
import type { Store } from '../../apps/functions/src/members/store'
import { MemberService } from '../../apps/functions/src/members/service'
import { TestResourceProvider } from './resources-suite'
import { testPng } from './forum-suite'
import type { ClubArticle, ForumPostView, Member } from '@electronic-club/shared'
import type { TimedSite } from '../../apps/functions/src/public-site-timed'

export class TestPublicStorage implements PublicSiteStorage {
  timedData: TimedSite | null = null
  objects = new Map<string, Uint8Array>()
  enabled = true
  failRead = false
  failPut = false
  failDelete = false
  uploads = 0
  beforeManifest?: () => Promise<void>
  origin() { return 'https://public.example.test' }
  configured() { return this.enabled }
  async read(): Promise<PublicSite | null> {
    if (this.failRead) throw Error('storage offline')
    const data = this.objects.get(PUBLIC_SITE_KEY)
    return data ? JSON.parse(new TextDecoder().decode(data)) as PublicSite : null
  }
  async asset(asset: PublicAsset) {
    const bytes = this.objects.get(asset.key)
    if (!bytes) throw Error('missing asset')
    return bytes
  }
  async timed() { return structuredClone(this.timedData) }
  async putTimed(data: TimedSite) { this.timedData = structuredClone(data) }
  async put(key: string, bytes: Uint8Array) {
    if (this.failPut) throw Error('upload offline')
    if (key === PUBLIC_SITE_KEY) await this.beforeManifest?.()
    this.objects.set(key, new Uint8Array(bytes))
    this.uploads++
  }
  async remove(key: string) {
    if (this.failDelete) throw Error('delete offline')
    this.objects.delete(key)
  }
}

export async function publicSiteSuite(store: Store, rootToken: string, clock?: () => number) {
  let now = clock?.() ?? Date.now()
  const storage = new TestPublicStorage(), resources = new TestResourceProvider()
  const service = new MemberService(store, () => now, resources, storage)
  const call = (method: string, path: string, input: unknown = {}, query: Record<string, string> = {}) => service.execute(rootToken, method, '/api' + path, input, query)
  const root = (await call('GET', '/auth/me')).data as { member: Member }
  // Fixture values live only in the isolated test database.
  const image = (await call('POST', '/media', { mime: 'image/png', bytes: testPng().length })).data as { id: string }
  await call('POST', `/media/${image.id}/chunks/0`, { data: testPng().toString('base64') })
  await call('POST', `/media/${image.id}/complete`)
  const staged = (await call('POST', '/media', { mime: 'image/png', bytes: testPng().length })).data as { id: string }
  await call('POST', `/media/${staged.id}/chunks/0`, { data: testPng().toString('base64') })
  await call('POST', `/media/${staged.id}/complete`)
  const article = (await call('POST', '/articles', { title: 'Public mirror fixture', content: `![图片](media:${image.id})`, status: 'published' })).data as ClubArticle
  const draft = (await call('POST', '/articles', { title: 'Draft fixture', content: 'DRAFT_BODY_SECRET', status: 'draft' })).data as ClubArticle
  const board = (await call('POST', '/forum/boards', { name: 'Public snapshot board', description: 'test', position: 999, status: 'active', requireReview: false })).data as { id: string }
  now += 31_000
  const post = (await call('POST', '/forum/posts', { boardId: board.id, title: 'Public snapshot post', body: 'Visible public body', imageIds: [] })).data as ForumPostView
  await store.run(async (tx) => {
    const current = await tx.get<object>('forum_posts', post.id)
    await tx.set('forum_posts', post.id, { ...current!, moderationReason: 'MODERATION_SECRET', futurePrivateField: 'FUTURE_FIELD_SECRET' })
  })
  now += 31_000
  const pendingBoard = (await call('POST', '/forum/boards', { name: 'Review snapshot board', description: 'test', position: 1000, status: 'active', requireReview: true })).data as { id: string }
  const pending = (await call('POST', '/forum/posts', { boardId: pendingBoard.id, title: 'Pending fixture', body: 'PENDING_BODY_SECRET', imageIds: [] })).data as ForumPostView
  const comment = (await call('POST', `/forum/posts/${post.id}/comments`, { body: 'Published reply', parentId: null })).data as { id: string }
  now += 6000
  await call('POST', `/forum/posts/${post.id}/comments`, { body: 'Nested reply', parentId: comment.id })
  const resourceId = randomUUID()
  await store.run(async (tx) => {
    await tx.set('club_resources', resourceId, { id: resourceId, title: 'Public PDF', description: 'test', category: '教程', originalName: 'guide.pdf', size: 12,
      mime: 'application/pdf', status: 'published', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), publishedAt: new Date(now).toISOString(),
      key: `electronicclub/resources/v1/${resourceId}.pdf`, bucket: 'test-resources', ownerUid: root.member.uid,
      hash: 'TestQiniuHash0123456789abcdef', expiresAt: new Date(now + 600000).toISOString() })
  })
  const result = await call('POST', '/public-site/rebuild')
  assert.equal(result.publicSync, 'ready')
  const snapshot = (await storage.read())!
  const json = JSON.stringify(snapshot)
  for (const secret of ['DRAFT_BODY_SECRET', 'PENDING_BODY_SECRET', 'MODERATION_SECRET', 'FUTURE_FIELD_SECRET', 'studentId', 'registrationIds', 'managerIds', 'ownerUid'])
    assert.ok(!json.includes(secret), 'private field must never appear in public object: ' + secret)
  assert.ok(snapshot.assets['/api/media/' + image.id])
  assert.equal(snapshot.assets['/api/media/' + staged.id], undefined)
  assert.ok(!snapshot.posts.some((v) => v.id === pending.id))
  assert.ok(!snapshot.articles.some((v) => v.id === draft.id))
  assert.ok(snapshot.comments.find((v) => v.parentId === comment.id)?.parent?.nickname)
  assert.equal(snapshot.resources.find((v) => v.id === resourceId)?.originalName, 'guide.pdf')
  return { service, storage, article, post, board, pending, draft, image, staged, resourceId, token: rootToken, advance: (ms: number) => { now += ms } }
}
