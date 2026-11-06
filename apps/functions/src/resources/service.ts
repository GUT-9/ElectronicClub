import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Identity } from '@electronic-club/shared'
import type { Store, Transaction } from '../members/store'
import type { Secure, StageResult } from '../stage3/service'
import { ensure, ApiError } from '../members/model'
import { fileType, metadataInput, resourceView, uploadInput } from './model'
import type { ResourceRecord } from './model'
import { QiniuProvider } from './qiniu'
import type { ResourceProvider } from './qiniu'
const stateKey = 'resources:storage'
function requireManager(ctx: Identity) {
  ensure(
    ctx.super || ctx.permissions.includes('resources.manage'),
    403,
    'FORBIDDEN',
    '没有资料管理权限',
  )
}
async function audit(
  tx: Transaction,
  uid: string,
  action: string,
  target: string,
  now: string,
) {
  const id = randomUUID()
  await tx.set('audit_logs', id, {
    id,
    actor: uid,
    action,
    target,
    fields: [],
    createdAt: now,
  })
}
export class ResourceService {
  constructor(
    private store: Store,
    private secure: Secure,
    private clock = () => Date.now(),
    private provider: ResourceProvider = new QiniuProvider(),
  ) {}
  async execute(
    token: string,
    method: string,
    path: string,
    input: unknown,
    q: Record<string, string>,
  ): Promise<StageResult> {
    const match = path.match(
      /^\/api\/resources(?:\/([a-f0-9-]{36}|uploads|config)(?:\/(complete|update|delete|download))?)?$/,
    )
    ensure(match, 404, 'NOT_FOUND', '资料接口不存在')
    const [, id, action] = match
    if (method === 'GET' && !id) {
      const options = z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(20),
          search: z.string().trim().max(80).default(''),
          category: z.string().trim().max(40).default(''),
          status: z
            .enum([
              'all',
              'uploading',
              'draft',
              'published',
              'deleting',
              'deleted',
            ])
            .optional(),
          admin: z.enum(['true', 'false']).default('false'),
        })
        .strict()
        .parse(q)
      const list = async () => {
        const result = await this.store.list<ResourceRecord>(
          'club_resources',
          {
            search: options.search,
            category: options.category,
            ...(options.admin === 'true'
              ? { status: options.status ?? 'all' }
              : { public: true, status: 'published' }),
          },
          {
            offset: (options.page - 1) * options.pageSize,
            limit: options.pageSize,
          },
        )
        return {
          data: {
            ...result,
            items: result.items.map(resourceView),
            page: options.page,
            pageSize: options.pageSize,
          },
        }
      }
      if (options.admin === 'true')
        return this.secure(token, async (_tx, ctx) => {
          requireManager(ctx)
          return list()
        })
      return list()
    }
    if (method === 'GET' && id === 'config')
      return this.secure(token, async (tx, ctx) => {
        requireManager(ctx)
        const state = await tx.get<{ bytes: number }>('system', stateKey)
        return {
          data: { ...this.provider.status(), reservedBytes: state?.bytes ?? 0 },
        }
      })
    if (method === 'POST' && id === 'uploads')
      return this.secure(token, async (tx, ctx) => {
        requireManager(ctx)
        const body = uploadInput.parse(input),
          type = fileType(body.originalName),
          status = this.provider.status()
        ensure(
          status.configured,
          503,
          'RESOURCE_STORAGE_NOT_CONFIGURED',
          '七牛资料存储尚未配置，请先完成云函数配置',
        )
        ensure(
          body.size <= status.maxBytes,
          400,
          'RESOURCE_TOO_LARGE',
          `资料文件超过当前大小上限（${Math.floor(status.maxBytes / 1024 / 1024)}MB）`,
        )
        const rateKey = 'resources:upload-rate:' + ctx.member.uid
        let rate = await tx.get<{ at: number; count: number }>(
          'system',
          rateKey,
        )
        if (!rate || rate.at + 600000 <= this.clock())
          rate = { at: this.clock(), count: 0 }
        ensure(
          rate.count < 10,
          429,
          'RESOURCE_RATE_LIMIT',
          '上传过于频繁，请稍后再试',
        )
        const current = (await tx.get<{ bytes: number }>(
          'system',
          stateKey,
        )) ?? { bytes: 0 }
        ensure(
          current.bytes + body.size <= status.budget,
          409,
          'RESOURCE_BUDGET',
          '资料库已达到预设存储预算，请先清理资料或调整预算',
        )
        const now = new Date(this.clock()).toISOString(),
          rid = randomUUID()
        const record: ResourceRecord = {
          ...body,
          id: rid,
          mime: type.mime,
          key: `electronicclub/resources/v1/${rid}.${type.ext}`,
          bucket: status.bucket,
          ownerUid: ctx.member.uid,
          hash: '',
          status: 'uploading',
          createdAt: now,
          updatedAt: now,
          publishedAt: null,
          expiresAt: new Date(this.clock() + 600000).toISOString(),
        }
        const ticket = this.provider.ticket(record, this.clock())
        await tx.set('club_resources', rid, record)
        await tx.set('system', stateKey, { bytes: current.bytes + body.size })
        await tx.set('system', rateKey, { ...rate, count: rate.count + 1 })
        await audit(tx, ctx.member.uid, 'resources.upload', rid, now)
        return { data: { id: rid, ...ticket } }
      })
    ensure(id && /^[a-f0-9-]{36}$/.test(id), 404, 'NOT_FOUND', '资料不存在')
    if (method === 'GET' && action === 'download') {
      const record = await this.store.read<ResourceRecord>('club_resources', id)
      ensure(
        record?.status === 'published',
        404,
        'NOT_FOUND',
        '资料尚未发布或已下架',
      )
      return {
        data: {
          url: this.provider.download(record),
          filename: record.originalName,
        },
      }
    }
    if (method === 'POST' && action === 'complete') {
      const result = await this.secure(token, async (tx, ctx) => {
        requireManager(ctx)
        z.object({}).strict().parse(input)
        const r = await tx.get<ResourceRecord>('club_resources', id)
        ensure(
          r && r.status === 'uploading',
          409,
          'RESOURCE_STATE',
          '资料不在待上传状态',
        )
        return { data: r }
      })
      const record = result.data as ResourceRecord,
        verified = await this.provider.verify(record)
      return this.secure(token, async (tx, ctx) => {
        requireManager(ctx)
        const current = await tx.get<ResourceRecord>('club_resources', id)
        ensure(
          current?.status === 'uploading' && current.key === record.key,
          409,
          'RESOURCE_STATE',
          '资料状态已改变，请刷新后重试',
        )
        const next = {
          ...current,
          hash: verified.hash,
          status: 'draft' as const,
          updatedAt: new Date(this.clock()).toISOString(),
        }
        await tx.set('club_resources', id, next)
        await audit(
          tx,
          ctx.member.uid,
          'resources.complete',
          id,
          next.updatedAt,
        )
        return { data: resourceView(next) }
      })
    }
    if (method === 'POST' && action === 'update')
      return this.secure(token, async (tx, ctx) => {
        requireManager(ctx)
        const body = metadataInput
          .extend({ status: z.enum(['draft', 'published']) })
          .parse(input)
        const record = await tx.get<ResourceRecord>('club_resources', id)
        ensure(
          record && ['draft', 'published'].includes(record.status),
          409,
          'RESOURCE_STATE',
          '文件尚未校验完成或已删除',
        )
        const next = {
          ...record,
          ...body,
          publishedAt:
            record.publishedAt ??
            (body.status === 'published'
              ? new Date(this.clock()).toISOString()
              : null),
          updatedAt: new Date(this.clock()).toISOString(),
        }
        await tx.set('club_resources', id, next)
        await audit(tx, ctx.member.uid, 'resources.update', id, next.updatedAt)
        return { data: resourceView(next) }
      })
    if (method === 'POST' && action === 'delete') {
      const result = await this.secure(token, async (tx, ctx) => {
        requireManager(ctx)
        z.object({}).strict().parse(input)
        const r = await tx.get<ResourceRecord>('club_resources', id)
        ensure(r, 404, 'NOT_FOUND', '资料不存在')
        if (r.status === 'deleted') return { data: r }
        const next = {
          ...r,
          status: 'deleting' as const,
          updatedAt: new Date(this.clock()).toISOString(),
        }
        await tx.set('club_resources', id, next)
        await audit(
          tx,
          ctx.member.uid,
          'resources.delete.request',
          id,
          next.updatedAt,
        )
        return { data: next }
      })
      const record = result.data as ResourceRecord
      if (record.status === 'deleted') return { data: { deleted: true } }
      // Do not release quota while a still-valid token could recreate the object.
      if (Date.parse(record.expiresAt) + 30000 > this.clock())
        return {
          data: {
            pending: true,
            deleteAfter: new Date(
              Date.parse(record.expiresAt) + 30000,
            ).toISOString(),
          },
        }
      await this.provider.remove(record)
      await finishDeletion(this.store, record, this.clock())
      return { data: { deleted: true } }
    }
    throw new ApiError(404, 'NOT_FOUND', '资料接口不存在')
  }
}
async function finishDeletion(
  store: Store,
  record: ResourceRecord,
  now: number,
) {
  await store.run(async (tx) => {
    const current = await tx.get<ResourceRecord>('club_resources', record.id)
    if (!current || current.status === 'deleted') return
    ensure(
      current.status === 'deleting',
      409,
      'RESOURCE_STATE',
      '资料状态已改变',
    )
    const state = (await tx.get<{ bytes: number }>('system', stateKey)) ?? {
      bytes: current.size,
    }
    await tx.set('club_resources', current.id, {
      ...current,
      status: 'deleted',
      updatedAt: new Date(now).toISOString(),
    })
    await tx.set('system', stateKey, {
      bytes: Math.max(0, state.bytes - current.size),
    })
    await audit(
      tx,
      'private-resource-cleanup',
      'resources.delete.complete',
      current.id,
      new Date(now).toISOString(),
    )
  })
}
export async function cleanupResources(
  store: Store,
  provider: ResourceProvider = new QiniuProvider(),
  now = Date.now(),
) {
  if (!provider.status().configured) return { skipped: true, removed: 0 }
  const page = await store.list<ResourceRecord>(
    'club_resources',
    {
      cleanupBefore: new Date(now - 30000).toISOString(),
      uploadBefore: new Date(now - 86400000).toISOString(),
    },
    { offset: 0, limit: 20 },
  )
  let removed = 0
  for (const row of page.items) {
    const current = await store.run(async (tx) => {
      const r = await tx.get<ResourceRecord>('club_resources', row.id)
      if (
        !r ||
        !['uploading', 'deleting'].includes(r.status) ||
        Date.parse(r.expiresAt) + 30000 > now
      )
        return null
      const next = { ...r, status: 'deleting' as const }
      await tx.set('club_resources', r.id, next)
      return next
    })
    if (!current) continue
    await provider.remove(current)
    await finishDeletion(store, current, now)
    removed++
  }
  return { removed, skipped: false }
}
