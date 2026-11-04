import {syncMedia,references} from '../media/model'
import { changeImageStorage } from './storage'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  Identity,
  Member,
  ForumBoard,
  ForumPost,
  ForumComment,
  ForumAuthor,
  ForumReport,
  ForumRestriction,
  ForumNotification,
} from '@electronic-club/shared'
import { FORUM_PERMISSIONS } from '@electronic-club/shared'
import type { Store, Transaction } from '../members/store'
import { ensure, studentIdSchema } from '../members/model'
import { studentIdKey } from '../members/crypto'
import type { Secure, StageResult } from '../stage3/service'
import {
  boardInput,
  postInput,
  commentInput,
  moderationInput,
  reasonInput,
  restrictionInput,
  imageInput,
} from './model'
import { inspectImage } from './images'
type ImageRecord = {
  id: string
  ownerUid: string
  postId: string | null
  dataUrl: string
  mime: string
  width: number
  height: number
  bytes: number
  status: 'staged' | 'attached'
  createdAt: string
}
const postModeration = [
  'forum.posts.review',
  'forum.posts.pin',
  'forum.posts.feature',
  'forum.posts.lock',
  'forum.posts.delete',
]
export class ForumService {
  constructor(
    private store: Store,
    private secure: Secure,
    private clock = () => Date.now(),
  ) {}
  private now() {
    return new Date(this.clock()).toISOString()
  }
  private can(ctx: Identity | undefined, p: string) {
    return !!ctx && (ctx.super || ctx.permissions.includes(p))
  }
  private require(ctx: Identity | undefined, p: string) {
    ensure(this.can(ctx, p), 403, 'FORBIDDEN', '没有此社区管理权限')
  }
  private member(ctx: Identity | undefined): Identity {
    ensure(ctx, 401, 'UNAUTHENTICATED', '请先登录')
    return ctx
  }
  private async audit(
    tx: Transaction,
    ctx: Identity,
    action: string,
    target: string,
    details: Record<string, string | boolean> = {},
  ) {
    const id = randomUUID()
    await tx.set('audit_logs', id, {
      id,
      actor: ctx.member.uid,
      action,
      target,
      details,
      fields: [],
      createdAt: this.now(),
    })
  }
  private async notify(
    tx: Transaction,
    uid: string,
    postId: string,
    message: string,
    commentId: string | null = null,
  ) {
    const id = randomUUID()
    await tx.set('forum_notifications', id, {
      id,
      recipientUid: uid,
      postId,
      commentId,
      message,
      read: false,
      createdAt: this.now(),
    })
  }
  private async rate(
    tx: Transaction,
    ctx: Identity,
    kind: string,
    limit: number,
    windowMs: number,
  ) {
    const id = `forum:rate:${ctx.member.uid}:${kind}`
    let state = await tx.get<{ count: number; start: number }>('system', id)
    if (!state || state.start + windowMs <= this.clock())
      state = { count: 0, start: this.clock() }
    ensure(
      state.count < limit,
      429,
      'FORUM_RATE_LIMIT',
      '操作过于频繁，请稍后再试',
    )
    state.count++
    await tx.set('system', id, state)
  }
  private async allowed(
    tx: Transaction,
    ctx: Identity,
    kind: 'posts' | 'comments',
  ) {
    const r = await tx.get<ForumRestriction>(
      'forum_user_restrictions',
      ctx.member.uid,
    )
    const end = kind === 'posts' ? r?.postsUntil : r?.commentsUntil
    ensure(
      !r || !r[kind] || (!!end && Date.parse(end) <= this.clock()),
      403,
      'FORUM_RESTRICTED',
      '账号暂时被限制此社区操作',
    )
  }
  private async board(tx: Transaction, id: string) {
    const b = await tx.get<ForumBoard>('forum_boards', id)
    ensure(b, 404, 'NOT_FOUND', '版块不存在')
    return { ...b, id }
  }
  private async post(tx: Transaction, id: string, ctx?: Identity) {
    const p = await tx.get<ForumPost>('forum_posts', id)
    ensure(p && p.status !== 'deleted', 404, 'NOT_FOUND', '帖子不存在或已删除')
    const board = await this.board(tx, p.boardId)
    const moderation =
      this.can(ctx, 'forum.posts.review') || this.can(ctx, 'forum.posts.delete')
    ensure(
      (p.status === 'published' && board.status !== 'hidden') ||
        ctx?.member.uid === p.authorUid ||
        moderation,
      404,
      'NOT_FOUND',
      '帖子不存在或尚未公开',
    )
    return { ...p, id }
  }
  private async author(tx: Transaction, uid: string): Promise<ForumAuthor> {
    const user = await tx.get<Member>('users', uid)
    return {
      uid,
      nickname:
        user && user.status !== 'deleted' ? user.nickname : '已注销成员',
      avatar:
        user &&
        user.status === 'active' &&
        /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(user.avatar)
          ? user.avatar
          : '',
    }
  }
  private async postView(tx: Transaction, p: ForumPost, ctx?: Identity) {
    const { moderationReason, ...publicFields } = p
    return {
      ...publicFields,
      ...(ctx?.member.uid === p.authorUid || this.can(ctx, 'forum.posts.review')
        ? { moderationReason }
        : {}),
      author: await this.author(tx, p.authorUid),
      board: await this.board(tx, p.boardId),
    }
  }
  private async publicPosts(
    tx: Transaction,
    items: ForumPost[],
    ctx?: Identity,
  ) {
    const values = await Promise.all(
      items.map(async (row) => {
        const current = await tx.get<ForumPost>('forum_posts', row.id)
        if (!current || current.status !== 'published') return null
        const board = await this.board(tx, current.boardId)
        if (board.status === 'hidden') return null
        const view = await this.postView(tx, { ...current, id: row.id }, ctx)
        return { ...view, body: view.body.slice(0, 240) }
      }),
    )
    return values.filter((value) => value !== null)
  }
  private async commentView(
    tx: Transaction,
    c: ForumComment,
    moderation = false,
  ) {
    if (c.status === 'deleted' || (c.status === 'hidden' && !moderation))
      return {
        ...c,
        body: c.status === 'deleted' ? '该评论已删除' : '该评论暂不可见',
        author: { uid: '', nickname: '', avatar: '' },
      }
    const parent = c.parentId
      ? await tx.get<ForumComment>('forum_comments', c.parentId)
      : null
    return {
      ...c,
      author: await this.author(tx, c.authorUid),
      parent: parent
        ? {
            id: parent.id,
            floor: parent.floor,
            nickname:
              parent.status === 'published'
                ? (await this.author(tx, parent.authorUid)).nickname
                : '已删除或隐藏',
          }
        : null,
    }
  }
  private async page(
    collection: string,
    filter: Record<string, unknown>,
    q: Record<string, string>,
  ) {
    const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(q.page ?? 1),
      pageSize = z.coerce
        .number()
        .int()
        .min(1)
        .max(30)
        .parse(q.pageSize ?? 20)
    return {
      ...(await this.store.list(collection, filter, {
        offset: (page - 1) * pageSize,
        limit: pageSize,
      })),
      page,
      pageSize,
    }
  }
  private async attach(
    tx: Transaction,
    ctx: Identity,
    postId: string,
    ids: string[],
  ) {
    ensure(
      new Set(ids).size === ids.length,
      400,
      'DUPLICATE_IMAGE',
      '图片不能重复',
    )
    for (const id of ids) {
      const image = await tx.get<ImageRecord>('forum_images', id)
      ensure(
        image &&
          image.ownerUid === ctx.member.uid &&
          (!image.postId || image.postId === postId),
        403,
        'IMAGE_SCOPE',
        '图片不属于当前成员或已用于其他帖子',
      )
      await tx.set('forum_images', id, { ...image, postId, status: 'attached' })
    }
  }
  async execute(
    token: string,
    method: string,
    path: string,
    input: unknown,
    q: Record<string, string>,
  ): Promise<StageResult> {
    const parts = path.slice('/api/forum'.length).split('/').filter(Boolean),
      [kind, id, action] = parts
    const publicRead =
      method === 'GET' &&
      ['boards', 'posts', 'images'].includes(kind ?? '') &&
      q.admin !== 'true'
    const work = async (
      tx: Transaction,
      ctx?: Identity,
    ): Promise<StageResult> => {
      if (kind === 'boards') {
        if (method === 'GET') {
          if (q.admin === 'true') this.require(ctx, 'forum.boards.manage')
          if (id) {
            const board = await this.board(tx, id)
            ensure(
              board.status !== 'hidden' || this.can(ctx, 'forum.boards.manage'),
              404,
              'NOT_FOUND',
              '版块不存在',
            )
            return { data: board }
          }
          return {
            data: await this.page(
              'forum_boards',
              q.admin === 'true' ? {} : { _public: true },
              q,
            ),
          }
        }
        ensure(method === 'POST', 404, 'NOT_FOUND', '接口不存在')
        this.require(ctx, 'forum.boards.manage')
        const data = boardInput.parse(input),
          now = this.now(),
          previous = id ? await this.board(tx, id) : null
        const board: ForumBoard = {
          ...data,
          id: id ?? randomUUID(),
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        }
        await tx.set('forum_boards', board.id, board)
        await this.audit(tx, ctx!, 'forum.boards.save', board.id, {
          status: board.status,
          requireReview: board.requireReview,
        })
        return { data: board }
      }
      if (kind === 'images') {
        if (method === 'POST' && !id) {
          const user = this.member(ctx)
          await this.allowed(tx, user, 'posts')
          await this.rate(tx, user, 'images', 6, 600000)
          const pending = await this.store.list(
            'forum_images',
            { ownerUid: user.member.uid, status: 'staged' },
            { offset: 0, limit: 1 },
          )
          ensure(
            pending.total < 6,
            409,
            'IMAGE_QUOTA',
            '未使用图片过多，请先发布帖子或移除未使用图片',
          )
          const data = imageInput.parse(input),
            image = inspectImage(data.dataUrl)
          const record: ImageRecord = {
            id: randomUUID(),
            ownerUid: user.member.uid,
            postId: null,
            dataUrl: data.dataUrl,
            mime: image.mime,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
            status: 'staged',
            createdAt: this.now(),
          }
          await changeImageStorage(tx, record.dataUrl.length)
          await tx.set('forum_images', record.id, record)
          return {
            data: {
              id: record.id,
              width: record.width,
              height: record.height,
              bytes: record.bytes,
            },
          }
        }
        if (method === 'POST' && id && action === 'delete') {
          const user = this.member(ctx),
            image = await tx.get<ImageRecord>('forum_images', id)
          ensure(
            image &&
              image.ownerUid === user.member.uid &&
              image.status === 'staged',
            403,
            'IMAGE_SCOPE',
            '只能移除本人未发布的图片',
          )
          await tx.remove('forum_images', id)
          await changeImageStorage(tx, -image.dataUrl.length)
          return { data: { ok: true } }
        }
        ensure(method === 'GET' && id, 404, 'NOT_FOUND', '图片不存在')
        const image = await tx.get<ImageRecord>('forum_images', id)
        ensure(image, 404, 'NOT_FOUND', '图片不存在')
        if (image.postId) {
          const post = await this.post(tx, image.postId, ctx)
          ensure(
            post.imageIds.includes(id),
            404,
            'NOT_FOUND',
            '图片已从帖子移除',
          )
        } else
          ensure(
            ctx?.member.uid === image.ownerUid,
            404,
            'NOT_FOUND',
            '图片尚未发布',
          )
        ensure(
          ['image/jpeg', 'image/png', 'image/webp'].includes(image.mime),
          404,
          'NOT_FOUND',
          '图片不存在',
        )
        const buffer = Buffer.from(image.dataUrl.split(',')[1] ?? '', 'base64')
        ensure(
          buffer.length <= 32768 && buffer.length === image.bytes,
          404,
          'NOT_FOUND',
          '图片数据不完整',
        )
        return { binary: buffer, contentType: image.mime }
      }
      if (kind === 'posts' && !id && method === 'GET') {
        const filter: Record<string, unknown> = { _public: true }
        if (q.boardId) filter.boardId = z.string().max(60).parse(q.boardId)
        if (q.search) filter._search = z.string().max(80).parse(q.search)
        const sort = z
          .enum(['latest', 'reply', 'hot', 'featured'])
          .parse(q.sort ?? 'latest')
        filter._sort = sort
        if (sort === 'featured') filter._featured = true
        const result = await this.page('forum_posts', filter, q)
        return {
          data: {
            ...result,
            items: await this.publicPosts(tx, result.items as ForumPost[], ctx),
          },
        }
      }
      if (kind === 'posts' && !id && method === 'POST') {
        const user = this.member(ctx)
        await this.allowed(tx, user, 'posts')
        await this.rate(tx, user, 'post-cooldown', 1, 30000)
        await this.rate(tx, user, 'post-hour', 10, 3600000)
        const data = postInput.parse(input),
          board = await this.board(tx, data.boardId)
        ensure(
          board.status === 'active',
          409,
          'BOARD_DISABLED',
          '此版块暂不接受新帖',
        )
        const now = this.now()
        const p: ForumPost = {
          ...data,
          id: randomUUID(),
          authorUid: user.member.uid,
          status: board.requireReview ? 'pending' : 'published',
          pinned: false,
          featured: false,
          locked: false,
          commentsClosed: false,
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          commentSequence: 0,
          lastReplyAt: now,
          createdAt: now,
          updatedAt: now,
        }
        await syncMedia(tx,user,'forum_posts',p.id,references(p.body))
        await tx.set('forum_posts', p.id, p)
        await this.attach(tx, user, p.id, p.imageIds)
        await this.audit(tx, user, 'forum.posts.create', p.id)
        return { data: await this.postView(tx, p, user) }
      }
      if (kind === 'posts' && id) {
        const post = await this.post(tx, id, ctx)
        if (method === 'GET' && !action)
          return { data: await this.postView(tx, post, ctx) }
        if (action === 'comments' && method === 'GET') {
          if (q.anchor) {
            const anchor = await tx.get<ForumComment>(
              'forum_comments',
              q.anchor,
            )
            ensure(
              anchor &&
                anchor.postId === id &&
                ['published', 'deleted'].includes(anchor.status),
              404,
              'NOT_FOUND',
              '回复已隐藏或不存在',
            )
            const before = await this.store.list(
              'forum_comments',
              { postId: id, _public: true, _beforeFloor: String(anchor.floor) },
              { offset: 0, limit: 1 },
            )
            q = {
              ...q,
              page: String(1 + Math.floor(before.total / 20)),
              pageSize: '20',
            }
          }
          const result = await this.page(
            'forum_comments',
            {
              postId: id,
              ...(post.status === 'published'
                ? { _public: true }
                : { status: 'published' }),
            },
            q,
          )
          return {
            data: {
              ...result,
              items: (
                await Promise.all(
                  (result.items as ForumComment[]).map(async (c) => {
                    const current = await tx.get<ForumComment>(
                      'forum_comments',
                      c.id,
                    )
                    return current &&
                      ['published', 'deleted'].includes(current.status)
                      ? this.commentView(tx, { ...current, id: c.id })
                      : null
                  }),
                )
              ).filter((value) => value !== null),
            },
          }
        }
        const user = this.member(ctx)
        if (action === 'state' && method === 'GET') {
          return {
            data: {
              liked: !!(await tx.get(
                'forum_likes',
                `${id}:${user.member.uid}`,
              )),
              favorited: !!(await tx.get(
                'forum_favorites',
                `${id}:${user.member.uid}`,
              )),
              own: post.authorUid === user.member.uid,
            },
          }
        }
        if (action === 'view' && method === 'POST') {
          const key = `forum:view:${id}:${user.member.uid}`,
            last = await tx.get<{ at: number }>('system', key)
          if (!last || last.at + 86400000 <= this.clock()) {
            post.viewCount++
            await tx.set('system', key, { at: this.clock() })
            await tx.set('forum_posts', id, post)
          }
          return { data: { viewCount: post.viewCount } }
        }
        if (action === 'update' && method === 'POST') {
          ensure(
            post.authorUid === user.member.uid,
            403,
            'FORBIDDEN',
            '只能编辑本人帖子',
          )
          ensure(!post.locked, 409, 'POST_LOCKED', '帖子已锁定')
          await this.allowed(tx, user, 'posts')
          await this.rate(tx, user, 'post-edit', 5, 60000)
          const data = postInput.parse(input),
            board = await this.board(tx, data.boardId)
          ensure(board.status === 'active', 409, 'BOARD_DISABLED', '版块已停用')
          await this.attach(tx, user, id, data.imageIds)
          const next = {
            ...post,
            ...data,
            status:
              board.requireReview ||
              post.status === 'hidden' ||
              post.status === 'pending'
                ? ('pending' as const)
                : ('published' as const),
            updatedAt: this.now(),
          }
          await syncMedia(tx,user,'forum_posts',id,references(next.body),references(post.body))
          await tx.set('forum_posts', id, next)
          for (const removed of post.imageIds.filter(
            (v) => !data.imageIds.includes(v),
          )) {
            const old = await tx.get<ImageRecord>('forum_images', removed)
            if (old) {
              await tx.remove('forum_images', removed)
              await changeImageStorage(tx, -old.dataUrl.length)
            }
          }
          await this.audit(tx, user, 'forum.posts.edit', id)
          return { data: await this.postView(tx, next, user) }
        }
        if (action === 'delete' && method === 'POST') {
          ensure(
            post.authorUid === user.member.uid,
            403,
            'FORBIDDEN',
            '只能删除本人帖子',
          )
          await tx.set('forum_posts', id, {
            ...post,
            status: 'deleted',
            updatedAt: this.now(),
          })
          await this.audit(tx, user, 'forum.posts.delete-own', id)
          return { data: { ok: true } }
        }
        if (action === 'comments' && method === 'POST') {
          ensure(
            post.status === 'published' && !post.locked && !post.commentsClosed,
            409,
            'COMMENTS_CLOSED',
            '帖子未公开、已锁定或已关闭评论',
          )
          const board = await this.board(tx, post.boardId)
          ensure(
            board.status === 'active',
            409,
            'BOARD_DISABLED',
            '版块暂不接受评论',
          )
          await this.allowed(tx, user, 'comments')
          await this.rate(tx, user, 'comment-cooldown', 1, 5000)
          await this.rate(tx, user, 'comment-hour', 60, 3600000)
          const data = commentInput.parse(input),
            parent = data.parentId
              ? await tx.get<ForumComment>('forum_comments', data.parentId)
              : null
          if (data.parentId)
            ensure(
              parent && parent.postId === id && parent.status === 'published',
              400,
              'INVALID_PARENT',
              '回复目标不属于此帖或已删除',
            )
          post.commentSequence++
          post.commentCount++
          post.lastReplyAt = this.now()
          const comment: ForumComment = {
            ...data,
            id: randomUUID(),
            postId: id,
            authorUid: user.member.uid,
            status: 'published',
            floor: post.commentSequence,
            createdAt: this.now(),
            updatedAt: this.now(),
          }
          await tx.set('forum_posts', id, post)
          await tx.set('forum_comments', comment.id, comment)
          const recipients = new Set([post.authorUid, parent?.authorUid])
          for (const uid of recipients)
            if (uid && uid !== user.member.uid)
              await this.notify(
                tx,
                uid,
                id,
                parent?.authorUid === uid
                  ? '有人回复了你的评论'
                  : '有人回复了你的帖子',
                comment.id,
              )
          await this.audit(tx, user, 'forum.comments.create', comment.id)
          return { data: await this.commentView(tx, comment) }
        }
        if (['like', 'favorite'].includes(action ?? '') && method === 'POST') {
          ensure(
            post.status === 'published',
            409,
            'POST_NOT_PUBLIC',
            '帖子尚未公开',
          )
          await this.rate(tx, user, 'reactions', 30, 60000)
          const data = z.object({ active: z.boolean() }).strict().parse(input),
            collection = action === 'like' ? 'forum_likes' : 'forum_favorites',
            key = `${id}:${user.member.uid}`,
            exists = await tx.get(collection, key)
          if (data.active && !exists) {
            await tx.set(collection, key, {
              id: key,
              postId: id,
              uid: user.member.uid,
              createdAt: this.now(),
            })
            if (action === 'like') post.likeCount++
          }
          if (!data.active && exists) {
            await tx.remove(collection, key)
            if (action === 'like')
              post.likeCount = Math.max(0, post.likeCount - 1)
          }
          if (action === 'like') await tx.set('forum_posts', id, post)
          return { data: { active: data.active, likeCount: post.likeCount } }
        }
        if (action === 'moderate' && method === 'POST') {
          const data = moderationInput.parse(input),
            permission = {
              approve: 'forum.posts.review',
              hide: 'forum.posts.review',
              delete: 'forum.posts.delete',
              pin: 'forum.posts.pin',
              feature: 'forum.posts.feature',
              lock: 'forum.posts.lock',
              'close-comments': 'forum.posts.lock',
            }[data.action]
          this.require(user, permission)
          if (data.action === 'approve') post.status = 'published'
          if (data.action === 'hide')
            post.status = data.value ? 'hidden' : 'published'
          if (data.action === 'delete') post.status = 'deleted'
          if (data.action === 'pin') post.pinned = data.value
          if (data.action === 'feature') post.featured = data.value
          if (data.action === 'lock') post.locked = data.value
          if (data.action === 'close-comments') post.commentsClosed = data.value
          post.moderationReason = data.reason
          post.updatedAt = this.now()
          await tx.set('forum_posts', id, post)
          await this.audit(tx, user, 'forum.posts.' + data.action, id, {
            reason: data.reason,
            value: data.value,
          })
          await this.notify(
            tx,
            post.authorUid,
            id,
            '你的帖子已被管理员处理：' + data.reason,
          )
          return { data: await this.postView(tx, post, user) }
        }
      }
      if (kind === 'comments' && id && method === 'POST') {
        const user = this.member(ctx),
          comment = await tx.get<ForumComment>('forum_comments', id)
        ensure(comment, 404, 'NOT_FOUND', '评论不存在')
        const post = await this.post(tx, comment.postId, user)
        if (action === 'delete') {
          ensure(
            comment.authorUid === user.member.uid,
            403,
            'FORBIDDEN',
            '只能删除本人评论',
          )
          if (comment.status === 'published')
            post.commentCount = Math.max(0, post.commentCount - 1)
          comment.status = 'deleted'
          await this.audit(tx, user, 'forum.comments.delete-own', id)
        } else if (action === 'moderate') {
          this.require(user, 'forum.comments.moderate')
          const data = z
            .object({
              status: z.enum(['published', 'hidden', 'deleted']),
              reason: z.string().trim().min(1).max(300),
            })
            .strict()
            .parse(input)
          if (comment.status === 'published' && data.status !== 'published')
            post.commentCount = Math.max(0, post.commentCount - 1)
          ensure(
            comment.status !== 'deleted' || data.status === 'deleted',
            409,
            'COMMENT_DELETED',
            '已删除评论不能重新公开',
          )
          if (comment.status !== 'published' && data.status === 'published')
            post.commentCount++
          comment.status = data.status
          await this.audit(tx, user, 'forum.comments.' + data.status, id, {
            reason: data.reason,
            status: data.status,
          })
          await this.notify(
            tx,
            comment.authorUid,
            post.id,
            '你的评论已被管理员处理：' + data.reason,
            id,
          )
        } else return this.notFound()
        comment.updatedAt = this.now()
        await tx.set('forum_comments', id, comment)
        await tx.set('forum_posts', post.id, post)
        return { data: { ok: true } }
      }
      if (kind === 'reports' && method === 'POST') {
        const user = this.member(ctx)
        if (!id) {
          await this.rate(tx, user, 'reports', 5, 86400000)
          const data = z
            .object({
              targetType: z.enum(['post', 'comment']),
              targetId: z.string().uuid(),
              reason: reasonInput.shape.reason,
            })
            .strict()
            .parse(input)
          let postId = data.targetId
          if (data.targetType === 'comment') {
            const c = await tx.get<ForumComment>(
              'forum_comments',
              data.targetId,
            )
            ensure(
              c && c.status === 'published',
              404,
              'NOT_FOUND',
              '评论不存在',
            )
            postId = c.postId
          }
          await this.post(tx, postId, user)
          const r: ForumReport = {
            ...data,
            id: randomUUID(),
            reporterUid: user.member.uid,
            postId,
            status: 'open',
            resolution: '',
            createdAt: this.now(),
            updatedAt: this.now(),
          }
          await tx.set('forum_reports', r.id, r)
          await this.audit(tx, user, 'forum.reports.create', r.id)
          return { data: r }
        }
        this.require(user, 'forum.reports.manage')
        const data = z
            .object({
              status: z.enum(['resolved', 'dismissed']),
              resolution: z.string().trim().min(2).max(500),
            })
            .strict()
            .parse(input),
          r = await tx.get<ForumReport>('forum_reports', id)
        ensure(r, 404, 'NOT_FOUND', '举报不存在')
        ensure(r.status === 'open', 409, 'REPORT_CLOSED', '举报已处理')
        await tx.set('forum_reports', id, {
          ...r,
          ...data,
          updatedAt: this.now(),
        })
        await this.audit(tx, user, 'forum.reports.' + data.status, id, {
          status: data.status,
          resolution: data.resolution,
        })
        await this.notify(
          tx,
          r.reporterUid,
          r.postId,
          '你的举报已处理：' + data.resolution,
        )
        return { data: { ok: true } }
      }
      if (kind === 'restrictions') {
        const user = this.member(ctx)
        this.require(user, 'forum.users.restrict')
        if (method === 'GET')
          return { data: await this.page('forum_user_restrictions', {}, q) }
        ensure(method === 'POST', 404, 'NOT_FOUND', '接口不存在')
        const data = restrictionInput.parse(input),
          studentId = studentIdSchema.parse(data.studentId),
          mapping = await tx.get<{ uid: string }>(
            'student_ids',
            studentIdKey(studentId),
          )
        ensure(mapping, 404, 'NOT_FOUND', '成员不存在')
        const target = await tx.get<Member>('users', mapping.uid)
        ensure(
          target?.status === 'active',
          409,
          'INACTIVE_MEMBER',
          '成员账号不是正常状态',
        )
        const { studentId: _sid, ...fields } = data
        void _sid
        const previous = await tx.get<ForumRestriction>(
          'forum_user_restrictions',
          mapping.uid,
        )
        const record = {
          ...fields,
          id: mapping.uid,
          uid: mapping.uid,
          createdAt: previous?.createdAt ?? this.now(),
          updatedAt: this.now(),
        }
        await tx.set('forum_user_restrictions', mapping.uid, record)
        await this.audit(tx, user, 'forum.users.restrict', mapping.uid, {
          posts: data.posts,
          comments: data.comments,
          reason: data.reason,
        })
        return { data: record }
      }
      if (kind === 'me') {
        const user = this.member(ctx)
        if (id === 'notifications' && action && method === 'POST') {
          const n = await tx.get<ForumNotification>(
            'forum_notifications',
            action,
          )
          ensure(
            n && n.recipientUid === user.member.uid,
            404,
            'NOT_FOUND',
            '通知不存在',
          )
          await tx.set('forum_notifications', action, { ...n, read: true })
          return { data: { ok: true } }
        }
        ensure(method === 'GET', 404, 'NOT_FOUND', '接口不存在')
        if (id === 'posts') {
          const result = await this.page(
            'forum_posts',
            { authorUid: user.member.uid, _notDeleted: true },
            q,
          )
          return {
            data: {
              ...result,
              items: await Promise.all(
                (result.items as ForumPost[]).map((p) =>
                  this.postView(tx, p, user),
                ),
              ),
            },
          }
        }
        if (id === 'comments') {
          const result = await this.page(
            'forum_comments',
            { authorUid: user.member.uid, _notDeleted: true },
            q,
          )
          return {
            data: {
              ...result,
              items: await Promise.all(
                (result.items as ForumComment[]).map((c) =>
                  this.commentView(tx, c),
                ),
              ),
            },
          }
        }
        if (id === 'favorites') {
          const result = await this.page(
            'forum_posts',
            { _favoriteUid: user.member.uid, _public: true },
            q,
          )
          return {
            data: {
              ...result,
              items: await Promise.all(
                (result.items as ForumPost[]).map((p) =>
                  this.postView(tx, p, user),
                ),
              ),
            },
          }
        }
        if (id === 'notifications')
          return {
            data: await this.page(
              'forum_notifications',
              { recipientUid: user.member.uid },
              q,
            ),
          }
        if (id === 'reports')
          return {
            data: await this.page(
              'forum_reports',
              { reporterUid: user.member.uid },
              q,
            ),
          }
        if (id === 'restrictions')
          return {
            data: await tx.get('forum_user_restrictions', user.member.uid),
          }
      }
      if (kind === 'admin' && method === 'GET') {
        const user = this.member(ctx)
        if (id === 'posts') {
          ensure(
            postModeration.some((p) => this.can(user, p)),
            403,
            'FORBIDDEN',
            '没有帖子管理权限',
          )
          const filter: Record<string, unknown> = {}
          if (
            !this.can(user, 'forum.posts.review') &&
            !this.can(user, 'forum.posts.delete')
          )
            filter._public = true
          if (q.status)
            filter.status = z
              .enum(['pending', 'published', 'hidden', 'deleted'])
              .parse(q.status)
          if (q.search) filter._search = z.string().max(80).parse(q.search)
          const result = await this.page('forum_posts', filter, q)
          return {
            data: {
              ...result,
              items: await Promise.all(
                (result.items as ForumPost[]).map((p) =>
                  this.postView(tx, p, user),
                ),
              ),
            },
          }
        }
        if (id === 'comments') {
          this.require(user, 'forum.comments.moderate')
          return {
            data: await this.page(
              'forum_comments',
              q.postId ? { postId: q.postId } : {},
              q,
            ),
          }
        }
        if (id === 'reports') {
          this.require(user, 'forum.reports.manage')
          return {
            data: await this.page(
              'forum_reports',
              q.status
                ? {
                    status: z
                      .enum(['open', 'resolved', 'dismissed'])
                      .parse(q.status),
                  }
                : {},
              q,
            ),
          }
        }
        if (id === 'audit') {
          ensure(
            FORUM_PERMISSIONS.some((p) => this.can(user, p)),
            403,
            'FORBIDDEN',
            '没有审核记录权限',
          )
          const result = await this.page('audit_logs', { _forumAudit: true }, q)
          const items = (
            result.items as { action: string; details?: unknown }[]
          ).map((row) => {
            const required = row.action.startsWith('forum.users.')
              ? 'forum.users.restrict'
              : row.action.startsWith('forum.reports.')
                ? 'forum.reports.manage'
                : row.action.startsWith('forum.comments.')
                  ? 'forum.comments.moderate'
                  : row.action.startsWith('forum.boards.')
                    ? 'forum.boards.manage'
                    : row.action === 'forum.posts.pin'
                      ? 'forum.posts.pin'
                      : row.action === 'forum.posts.feature'
                        ? 'forum.posts.feature'
                        : [
                              'forum.posts.lock',
                              'forum.posts.close-comments',
                            ].includes(row.action)
                          ? 'forum.posts.lock'
                          : 'forum.posts.review'
            return this.can(user, required)
              ? row
              : { ...row, details: undefined }
          })
          return { data: { ...result, items } }
        }
      }
      return this.notFound()
    }
    if (publicRead && !token) return this.store.run((tx) => work(tx))
    try {
      return await this.secure(token, (tx, ctx) => work(tx, ctx))
    } catch (error) {
      if (publicRead && (error as { status?: number }).status === 401)
        return this.store.run((tx) => work(tx))
      throw error
    }
  }
  private notFound(): never {
    ensure(false, 404, 'NOT_FOUND', '社区接口不存在')
  }
}
