import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  MAX_MEDIA_IMAGE_BYTES,
  MEDIA_CHUNK_BYTES,
} from '@electronic-club/shared'
import type {
  Identity,
  ForumBoard,
  ForumPost,
  ClubEvent,
  ClubArticle,
  PopupAnnouncement,
} from '@electronic-club/shared'
import type { Transaction, Store } from '../members/store'
import type { Secure, StageResult } from '../stage3/service'
import { ensure, ApiError } from '../members/model'
import { inspectImage } from '../forum/images'
import { changeImageStorage } from '../forum/storage'
import type { MediaImage } from './model'
export class MediaService {
  constructor(
    private store: Store,
    private secure: Secure,
    private clock = () => Date.now(),
  ) {}
  private async readable(tx: Transaction, image: MediaImage, ctx?: Identity) {
    if (ctx?.member.uid === image.ownerUid || ctx?.super) return true
    for (const b of image.bindings) {
      if (b.kind === 'forum_posts') {
        const post = await tx.get<ForumPost>('forum_posts', b.id)
        if (!post || post.status === 'deleted') continue
        const board = await tx.get<ForumBoard>('forum_boards', post.boardId)
        if (post.status === 'published' && board && board.status !== 'hidden')
          return true
        if (
          ctx &&
          (post.authorUid === ctx.member.uid ||
            ctx.permissions.some((p) =>
              ['forum.posts.review', 'forum.posts.delete'].includes(p),
            ))
        )
          return true
      } else if (b.kind === 'events') {
        const event = await tx.get<ClubEvent>('events', b.id)
        if (event?.status === 'published') return true
        if (
          event &&
          event.status !== 'deleted' &&
          ctx &&
          (event.managerIds.includes(ctx.member.uid) ||
            ctx.permissions.some((p) =>
              [
                'events.edit',
                'events.delete',
                'events.registrations.read',
                'events.registrations.review',
                'events.registrations.export',
                'events.checkin.manage',
              ].includes(p),
            ))
        )
          return true
      } else if (b.kind === 'articles') {
        const article = await tx.get<ClubArticle>('articles', b.id)
        if (article?.status === 'published') return true
        if (
          article &&
          article.status !== 'deleted' &&
          ctx &&
          (article.publisherUid === ctx.member.uid ||
            ctx.permissions.some((p) =>
              ['articles.edit', 'articles.publish', 'articles.delete'].includes(
                p,
              ),
            ))
        )
          return true
      } else {
        const popup = await tx.get<PopupAnnouncement>(
          'popup_announcements',
          b.id,
        )
        if (
          !popup?.enabled ||
          popup.state === 'retired' ||
          popup.state === 'disabled' ||
          popup.startsAt > new Date(this.clock()).toISOString() ||
          popup.expiresAt <= new Date(this.clock()).toISOString()
        )
          continue
        const parent = await tx.get<ClubEvent | ClubArticle>(
          popup.targetType === 'event' ? 'events' : 'articles',
          popup.targetId,
        )
        if (parent?.status === 'published') return true
      }
    }
    return false
  }
  async execute(
    token: string,
    method: string,
    path: string,
    input: unknown,
  ): Promise<StageResult> {
    const m = path.match(
      /^\/api\/media(?:\/([0-9a-f-]{36})(?:\/(complete|delete|chunks\/([0-2])))?)?$/,
    )
    ensure(m, 404, 'NOT_FOUND', '图片接口不存在')
    const [, id, action, index] = m
    const work = async (
      tx: Transaction,
      ctx?: Identity,
    ): Promise<StageResult> => {
      if (method === 'POST' && !id) {
        ensure(ctx, 401, 'UNAUTHENTICATED', '请先登录')
        const restriction = await tx.get<{
          posts: boolean
          postsUntil: string | null
        }>('forum_user_restrictions', ctx.member.uid)
        const restricted =
          restriction?.posts &&
          (!restriction.postsUntil ||
            Date.parse(restriction.postsUntil) > this.clock())
        ensure(
          !restricted ||
            ctx.super ||
            ctx.permissions.some((p) =>
              [
                'events.create',
                'events.edit',
                'articles.create',
                'articles.edit',
                'announcements.popup.manage',
              ].includes(p),
            ),
          403,
          'FORUM_RESTRICTED',
          '当前账号已被限制发布图片',
        )
        const body = z
          .object({
            mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
            bytes: z.number().int().min(20).max(MAX_MEDIA_IMAGE_BYTES),
          })
          .strict()
          .parse(input)
        const key = 'media:uploads:' + ctx.member.uid
        let state = (await tx.get<{
          start: number
          count: number
          pending: string[]
        }>('system', key)) ?? { start: this.clock(), count: 0, pending: [] }
        if (state.start + 600000 <= this.clock())
          state = { ...state, start: this.clock(), count: 0 }
        const pending = await Promise.all(
          state.pending.map((i) => tx.get<MediaImage>('media_images', i)),
        )
        state.pending = pending
          .filter((i) => i && !i.bindings.length)
          .map((i) => i!.id)
        ensure(
          state.count < 24 && state.pending.length < 16,
          429,
          'MEDIA_RATE_LIMIT',
          '未发布图片过多或上传过于频繁，请先保存内容或移除未使用的图片',
        )
        const image: MediaImage = {
          id: randomUUID(),
          ownerUid: ctx.member.uid,
          ...body,
          chunkCount: Math.ceil(body.bytes / MEDIA_CHUNK_BYTES),
          status: 'uploading',
          bindings: [],
          createdAt: new Date(this.clock()).toISOString(),
        }
        await changeImageStorage(tx, Math.ceil(image.bytes / 3) * 4)
        await tx.set('media_images', image.id, image)
        await tx.set('system', key, {
          ...state,
          count: state.count + 1,
          pending: [...state.pending, image.id],
        })
        return { data: { id: image.id, chunkCount: image.chunkCount } }
      }
      const image = id ? await tx.get<MediaImage>('media_images', id) : null
      ensure(image, 404, 'NOT_FOUND', '图片不存在')
      if (method === 'GET' && !action) {
        ensure(
          image.status === 'ready' && (await this.readable(tx, image, ctx)),
          404,
          'NOT_FOUND',
          '图片尚未公开或不存在',
        )
        const data = await this.bytes(tx, image)
        return { binary: data, contentType: image.mime }
      }
      ensure(
        ctx && image.ownerUid === ctx.member.uid,
        403,
        'MEDIA_OWNER',
        '只能操作本人上传的图片',
      )
      if (method === 'POST' && action?.startsWith('chunks/')) {
        ensure(
          image.status === 'uploading',
          409,
          'MEDIA_COMPLETE',
          '图片已完成上传',
        )
        const n = Number(index)
        ensure(n < image.chunkCount, 400, 'INVALID_CHUNK', '图片分片编号无效')
        const { data } = z
          .object({ data: z.string().min(1).max(32768) })
          .strict()
          .parse(input)
        const chunk = Buffer.from(data, 'base64'),
          expected = Math.min(
            MEDIA_CHUNK_BYTES,
            image.bytes - n * MEDIA_CHUNK_BYTES,
          )
        ensure(
          chunk.toString('base64') === data && chunk.length === expected,
          400,
          'INVALID_CHUNK',
          '图片分片大小或格式无效',
        )
        await tx.set('media_chunks', `${image.id}:${n}`, {
          id: `${image.id}:${n}`,
          imageId: image.id,
          index: n,
          data,
        })
        return { data: { ok: true } }
      }
      if (method === 'POST' && action === 'complete') {
        z.object({}).strict().parse(input)
        const bytes = await this.bytes(tx, image)
        const inspected = inspectImage(
          `data:${image.mime};base64,${bytes.toString('base64')}`,
          MAX_MEDIA_IMAGE_BYTES,
        )
        await tx.set('media_images', image.id, {
          ...image,
          status: 'ready',
          width: inspected.width,
          height: inspected.height,
        })
        return {
          data: {
            id: image.id,
            bytes: image.bytes,
            width: inspected.width,
            height: inspected.height,
          },
        }
      }
      if (method === 'POST' && action === 'delete') {
        z.object({}).strict().parse(input)
        ensure(
          !image.bindings.length,
          409,
          'MEDIA_IN_USE',
          '图片仍被正文或封面使用，请先在编辑器中移除并保存',
        )
        await removeMedia(tx, image)
        return { data: { ok: true } }
      }
      throw new ApiError(404, 'NOT_FOUND', '图片接口不存在')
    }
    if (method === 'GET') {
      // Published images need no session writes: a page can request many images
      // concurrently without contending on the shared authorization control row.
      try {
        return await this.store.run((tx) => work(tx))
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404) || !token)
          throw error
      }
      try {
        return await this.secure(token, work)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          throw new ApiError(404, 'NOT_FOUND', '图片尚未公开或不存在')
        throw error
      }
    }
    return this.secure(token, (tx, ctx) => work(tx, ctx))
  }
  private async bytes(tx: Transaction, image: MediaImage) {
    const chunks = await Promise.all(
      Array.from({ length: image.chunkCount }, (_, n) =>
        tx.get<{ data: string }>('media_chunks', `${image.id}:${n}`),
      ),
    )
    ensure(
      chunks.every(Boolean),
      409,
      'MEDIA_INCOMPLETE',
      '图片未上传完整，请重试',
    )
    const bytes = Buffer.concat(
      chunks.map((c) => Buffer.from(c!.data, 'base64')),
    )
    ensure(
      bytes.length === image.bytes,
      409,
      'MEDIA_INCOMPLETE',
      '图片大小不一致',
    )
    return bytes
  }
}
export async function removeMedia(tx: Transaction, image: MediaImage) {
  for (let n = 0; n < image.chunkCount; n++)
    await tx.remove('media_chunks', `${image.id}:${n}`)
  await tx.remove('media_images', image.id)
  await changeImageStorage(tx, -Math.ceil(image.bytes / 3) * 4)
}
