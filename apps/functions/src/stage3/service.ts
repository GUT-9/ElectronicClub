import { syncMedia, references } from '../media/model'
import { managerOptions, managerSummaries } from './manager-options'
import type { RosterResult } from './roster-query'
import { validateRosterQuery } from './roster-query'
import {
  MAX_EVENT_MANAGERS,
  DEFAULT_CHECKIN_TTL_SECONDS,
  MAX_CHECKIN_TTL_SECONDS,
} from '@electronic-club/shared'
import { studentIdKey } from '../members/crypto'
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto'
import { z } from 'zod'
import type {
  Identity,
  Member,
  ClubEvent,
  ClubArticle,
  Registration,
  PopupAnnouncement,
  EventAccess,
} from '@electronic-club/shared'
import type { Store, Transaction } from '../members/store'
import { ApiError, ensure, studentIdSchema } from '../members/model'
import { exportWorkbook } from '../members/xlsx'
import { eventSchema, articleSchema, popupSchema } from './model'
export interface StageResult {
  contentType?: string
  data?: unknown
  binary?: Buffer
  filename?: string
}
export type Secure = (
  token: string,
  fn: (tx: Transaction, ctx: Identity) => Promise<StageResult>,
) => Promise<StageResult>
type Catalog = { events: string[]; articles: string[]; popups: string[] }
const empty = (): Catalog => ({ events: [], articles: [], popups: [] })
const sha = (v: string) => createHash('sha256').update(v).digest('hex')
const publicEvent = (e: ClubEvent) => {
  const { managerIds: _managers, registrationIds: _rows, ...data } = e
  void _managers
  void _rows
  return data
}
export class Stage3Service {
  constructor(
    private store: Store,
    private secure: Secure,
    private clock = () => Date.now(),
  ) {}
  private now() {
    return new Date(this.clock()).toISOString()
  }
  private async content<T extends ClubEvent | ClubArticle>(
    tx: Transaction,
    collection: 'events' | 'articles',
    id: string,
  ): Promise<T | null> {
    const value = await tx.get<T>(collection, id)
    if (!value) return null
    if (value.id !== id)
      console.warn(
        JSON.stringify({
          category: 'data',
          stage: 'content_read',
          code: 'CONTENT_ID_MISMATCH',
          collection,
        }),
      )
    // The lookup key is authoritative. A legacy/manual JSON edit must never
    // redirect a subsequent mutation to another activity or article.
    return { ...value, id }
  }
  private can(ctx: Identity, p: string) {
    return ctx.super || ctx.permissions.includes(p)
  }
  private require(ctx: Identity, p: string) {
    ensure(this.can(ctx, p), 403, 'FORBIDDEN', '没有此操作权限')
  }
  private readableEvent(ctx: Identity, e: ClubEvent) {
    return (
      ctx.super ||
      e.managerIds.includes(ctx.member.uid) ||
      [
        'events.edit',
        'events.delete',
        'events.registrations.read',
        'events.registrations.review',
        'events.registrations.export',
        'events.checkin.manage',
      ].some((p) => ctx.permissions.includes(p))
    )
  }
  private scope(ctx: Identity, e: ClubEvent, p: string) {
    ensure(
      this.can(ctx, p) || e.managerIds.includes(ctx.member.uid),
      403,
      'EVENT_SCOPE',
      '未获此活动管理授权',
    )
  }
  private access(ctx: Identity, e: ClubEvent): EventAccess {
    const manager = e.managerIds.includes(ctx.member.uid)
    const can = (p: string) => this.can(ctx, p) || manager
    return {
      edit: can('events.edit'),
      assignManagers: this.can(ctx, 'events.edit'),
      roster: [
        'events.registrations.read',
        'events.registrations.review',
        'events.registrations.export',
        'events.checkin.manage',
      ].some(can),
      review: can('events.registrations.review'),
      export: can('events.registrations.export'),
      checkin: can('events.checkin.manage'),
    }
  }
  private async audit(
    tx: Transaction,
    ctx: Identity,
    action: string,
    target: string,
  ) {
    const id = randomUUID()
    await tx.set('audit_logs', id, {
      id,
      actor: ctx.member.uid,
      action,
      target,
      fields: [],
      createdAt: this.now(),
    })
  }
  private async catalog(tx: Transaction) {
    return (await tx.get<Catalog>('system', 'stage3_catalog')) ?? empty()
  }
  private async page<T>(items: T[], q: Record<string, string>) {
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
        .max(100)
        .parse(q.pageSize ?? 20)
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    }
  }
  private async roster(e: ClubEvent, q: Record<string, string>) {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().max(100).default(''),
        college: z.string().max(100).default(''),
        className: z.string().max(100).default(''),
        status: z
          .enum(['', 'pending', 'approved', 'rejected', 'cancelled', 'manual'])
          .default(''),
        checkedIn: z.enum(['', 'yes', 'no']).default(''),
      })
      .strict()
      .parse(q)
    const { page, pageSize, ...filters } = parsed
    const filter = { ...filters, eventId: e.id },
      options = { offset: (page - 1) * pageSize, limit: pageSize }
    validateRosterQuery(filter, options)
    return {
      ...((await this.store.list<Registration>(
        'event_roster',
        filter,
        options,
      )) as RosterResult),
      page,
      pageSize,
    }
  }
  private async retireDue(tx: Transaction, catalog: Catalog, except = '') {
    for (const id of catalog.popups) {
      if (id === except) continue
      const p = await tx.get<PopupAnnouncement>('popup_announcements', id)
      if (p && p.enabled && p.state !== 'retired' && p.startsAt <= this.now())
        await tx.set('popup_announcements', id, {
          ...p,
          state: 'retired',
          updatedAt: this.now(),
        })
    }
  }
  private async popup(tx: Transaction) {
    const catalog = await this.catalog(tx),
      now = this.now()
    const all = (
      await Promise.all(
        catalog.popups.map((id) =>
          tx.get<PopupAnnouncement>('popup_announcements', id),
        ),
      )
    ).filter((v): v is PopupAnnouncement => !!v)
    const eligible: PopupAnnouncement[] = []
    for (const p of all) {
      if (
        !p.enabled ||
        p.state === 'retired' ||
        p.startsAt > now ||
        p.expiresAt <= now
      )
        continue
      const target = await this.content<ClubEvent | ClubArticle>(
        tx,
        p.targetType === 'event' ? 'events' : 'articles',
        p.targetId,
      )
      if (target?.status === 'published') eligible.push(p)
    }
    eligible.sort(
      (a, b) =>
        b.priority - a.priority ||
        b.startsAt.localeCompare(a.startsAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    )
    const chosen = eligible[0] ?? null
    for (const p of all) {
      const state =
        p.id === chosen?.id
          ? 'active'
          : p.state === 'active' || (p.enabled && p.expiresAt <= now)
            ? 'retired'
            : p.state
      if (state !== p.state)
        await tx.set('popup_announcements', p.id, {
          ...p,
          state,
          updatedAt: now,
        })
    }
    const current = await tx.get<{
      popupId: string | null
      version: string | null
    }>('popup_state', 'current')
    if (
      !current ||
      current.popupId !== (chosen?.id ?? null) ||
      current.version !== (chosen?.version ?? null)
    )
      await tx.set('popup_state', 'current', {
        id: 'current',
        popupId: chosen?.id ?? null,
        version: chosen?.version ?? null,
        updatedAt: now,
      })
    return chosen ? { ...chosen, state: 'active' } : null
  }
  async execute(
    token: string,
    method: string,
    path: string,
    input: unknown,
    q: Record<string, string>,
  ): Promise<StageResult> {
    // Some HTTP gateways do not forward PATCH bodies consistently. Keep PATCH
    // clients compatible and route the POST update alias through exactly the
    // same authentication, scope checks, validation and transaction below.
    if (
      method === 'POST' &&
      /^\/api\/(events|articles)\/[^/]+\/update$/.test(path)
    ) {
      path = path.slice(0, -'/update'.length)
      method = 'PATCH'
    }
    const publicRead = method === 'GET' && path.startsWith('/api/public/')
    const work = async (
      tx: Transaction,
      ctx?: Identity,
    ): Promise<StageResult> => {
      const cat = await this.catalog(tx)
      if (path === '/api/public/popup') return { data: await this.popup(tx) }
      if (path.startsWith('/api/public/')) {
        const [, kind, id] = path.slice('/api/public'.length).split('/')
        const collection =
          kind === 'events' ? 'events' : kind === 'articles' ? 'articles' : ''
        ensure(collection, 404, 'NOT_FOUND', '接口不存在')
        if (id) {
          const item = await this.content<ClubEvent | ClubArticle>(
            tx,
            collection,
            id,
          )
          ensure(
            item?.status === 'published',
            404,
            'NOT_FOUND',
            '内容未发布或不存在',
          )
          return {
            data:
              collection === 'events' ? publicEvent(item as ClubEvent) : item,
          }
        }
        const ids = collection === 'events' ? cat.events : cat.articles
        const items = (
          await Promise.all(
            ids.map((id) =>
              this.content<ClubEvent | ClubArticle>(tx, collection, id),
            ),
          )
        )
          .filter(
            (v): v is ClubEvent | ClubArticle =>
              !!v && v.status === 'published',
          )
          .filter(
            (v) =>
              (!q.search || v.title.includes(q.search)) &&
              (!q.category || ('category' in v && v.category === q.category)),
          )
          .sort(
            (a, b) =>
              Number('pinned' in b && b.pinned) -
                Number('pinned' in a && a.pinned) ||
              String(b.publishedAt).localeCompare(String(a.publishedAt)),
          )
        return {
          data: await this.page(
            items.map((v) =>
              collection === 'events' ? publicEvent(v as ClubEvent) : v,
            ),
            q,
          ),
        }
      }
      ensure(ctx, 401, 'UNAUTHENTICATED', '请先登录')
      const parts = path.slice('/api/'.length).split('/'),
        kind = parts[0],
        id = parts[1],
        action = parts[2]
      if (kind === 'events') {
        if (id === 'manager-options' || id === 'manager-roles') {
          const result = await managerOptions(
            tx,
            this.store,
            ctx,
            method,
            id,
            action,
            input,
            q,
          )
          await this.audit(tx, ctx, 'events.manager_candidates', 'users')
          return result
        }
        if (!id && method === 'GET') {
          const all = (
            await Promise.all(
              cat.events.map((id) => this.content<ClubEvent>(tx, 'events', id)),
            )
          ).filter(
            (e): e is ClubEvent =>
              !!e &&
              e.status !== 'deleted' &&
              this.readableEvent(ctx, e) &&
              (!q.search || e.title.includes(q.search)) &&
              (!q.status || e.status === q.status),
          )
          return { data: await this.page(all, q) }
        }
        if (!id && method === 'POST') {
          this.require(ctx, 'events.create')
          const data = eventSchema.parse(input)
          if (data.managerIds.some((uid) => uid !== ctx.member.uid))
            this.require(ctx, 'events.edit')
          for (const uid of data.managerIds) {
            const member = await tx.get<{ status: string }>('users', uid)
            ensure(
              member?.status === 'active',
              400,
              'INVALID_MANAGER',
              '负责人须为有效成员',
            )
          }
          const event: ClubEvent = {
            ...data,
            id: randomUUID(),
            publisherUid: ctx.member.uid,
            publisherName: ctx.member.nickname,
            publishedAt: data.status === 'published' ? this.now() : null,
            createdAt: this.now(),
            updatedAt: this.now(),
            registrationIds: [],
            occupied: 0,
            checkinOpen: false,
          }
          if (!event.managerIds.includes(ctx.member.uid))
            event.managerIds.push(ctx.member.uid)
          ensure(
            event.managerIds.length <= MAX_EVENT_MANAGERS,
            400,
            'MANAGER_LIMIT',
            `负责人最多${MAX_EVENT_MANAGERS}人，包含创建者`,
          )
          await syncMedia(
            tx,
            ctx,
            'events',
            event.id,
            references(event.content, event.cover),
          )
          await tx.set('events', event.id, event)
          for (const uid of event.managerIds)
            await tx.set('event_managers', `${event.id}:${uid}`, {
              eventId: event.id,
              uid,
            })
          cat.events.push(event.id)
          await tx.set('system', 'stage3_catalog', cat)
          await this.audit(tx, ctx, 'events.create', event.id)
          return { data: event }
        }
        if (id === 'manager-lookup' && method === 'GET') {
          this.require(ctx, 'events.edit')
          const studentId = studentIdSchema.parse(q.studentId)
          const mapping = await tx.get<{ uid: string }>(
            'student_ids',
            studentIdKey(studentId),
          )
          const member = mapping
            ? await tx.get<Member>('users', mapping.uid)
            : null
          ensure(
            member?.status === 'active',
            404,
            'NOT_FOUND',
            '未找到有效成员',
          )
          await this.audit(tx, ctx, 'events.manager_lookup', member.uid)
          return {
            data: {
              uid: member.uid,
              studentId: member.studentId,
              nickname: member.nickname,
            },
          }
        }
        const event = await this.content<ClubEvent>(tx, 'events', id!)
        ensure(
          event && event.status !== 'deleted',
          404,
          'NOT_FOUND',
          '活动不存在',
        )
        if (!action && method === 'GET') {
          ensure(
            this.readableEvent(ctx, event),
            403,
            'EVENT_SCOPE',
            '未获活动查看授权',
          )
          return { data: event }
        }
        if (action === 'access' && method === 'GET')
          return { data: this.access(ctx, event) }
        if (action === 'managers' && method === 'GET') {
          ensure(
            this.readableEvent(ctx, event),
            403,
            'EVENT_SCOPE',
            '未获此活动管理授权',
          )
          return {
            data: { items: await managerSummaries(tx, event.managerIds) },
          }
        }
        if (!action && method === 'PATCH') {
          this.scope(ctx, event, 'events.edit')
          const data = eventSchema.parse({
            ...Object.fromEntries(
              Object.keys(eventSchema.shape).map((key) => [
                key,
                (event as unknown as Record<string, unknown>)[key],
              ]),
            ),
            ...z.record(z.string(), z.unknown()).parse(input),
          })
          if (
            data.managerIds.length !== event.managerIds.length ||
            data.managerIds.some((uid) => !event.managerIds.includes(uid))
          )
            this.require(ctx, 'events.edit')
          ensure(
            data.capacity === null || data.capacity >= event.occupied,
            409,
            'CAPACITY_BELOW_OCCUPIED',
            '人数上限不能低于已占名额',
          )
          for (const uid of data.managerIds) {
            const member = await tx.get<{ status: string }>('users', uid)
            ensure(
              member &&
                (member.status === 'active' || event.managerIds.includes(uid)),
              400,
              'INVALID_MANAGER',
              '负责人须为有效成员',
            )
          }
          for (const uid of event.managerIds)
            await tx.remove('event_managers', `${event.id}:${uid}`)
          for (const uid of data.managerIds)
            await tx.set('event_managers', `${event.id}:${uid}`, {
              eventId: event.id,
              uid,
            })
          const next = {
            ...event,
            ...data,
            checkinOpen:
              data.checkinEnabled &&
              data.status === 'published' &&
              event.checkinOpen,
            publishedAt:
              event.publishedAt ??
              (data.status === 'published' ? this.now() : null),
            updatedAt: this.now(),
          }
          await syncMedia(
            tx,
            ctx,
            'events',
            event.id,
            references(next.content, next.cover),
            references(event.content, event.cover),
          )
          await tx.set('events', event.id, next)
          if (!next.checkinOpen)
            await tx.set('system', `checkin:${event.id}`, {
              hash: '',
              expiresAt: 0,
            })
          await this.audit(tx, ctx, 'events.edit', event.id)
          return { data: next }
        }
        if (!action && method === 'DELETE') {
          this.require(ctx, 'events.delete')
          await tx.set('events', event.id, {
            ...event,
            status: 'deleted',
            updatedAt: this.now(),
          })
          await this.audit(tx, ctx, 'events.delete', event.id)
          return { data: { ok: true } }
        }
        if (action === 'member-lookup' && method === 'GET') {
          this.scope(ctx, event, 'events.checkin.manage')
          const studentId = studentIdSchema.parse(q.studentId)
          const mapping = await tx.get<{ uid: string }>(
            'student_ids',
            studentIdKey(studentId),
          )
          const member = mapping
            ? await tx.get<Member>('users', mapping.uid)
            : null
          ensure(
            member?.status === 'active',
            404,
            'NOT_FOUND',
            '未找到有效成员',
          )
          await this.audit(tx, ctx, 'events.checkin_member_lookup', event.id)
          return {
            data: {
              uid: member.uid,
              studentId: member.studentId,
              nickname: member.nickname,
            },
          }
        }
        const registrationId = `${event.id}:${ctx.member.uid}`
        if (action === 'registration' && method === 'GET')
          return {
            data: await tx.get<Registration>('registrations', registrationId),
          }
        if (action === 'registration' && method === 'POST') {
          const body = z
            .object({ note: z.string().trim().max(2000).default('') })
            .strict()
            .parse(input)
          ensure(
            event.status === 'published' && event.registrationEnabled,
            409,
            'REGISTRATION_CLOSED',
            '活动未开放报名',
          )
          ensure(
            (!event.registrationStartsAt ||
              this.now() >= event.registrationStartsAt) &&
              this.now() < event.registrationDeadline,
            409,
            'REGISTRATION_TIME',
            '不在报名时间内',
          )
          ensure(
            event.notesEnabled || !body.note,
            400,
            'NOTES_DISABLED',
            '活动未开启备注',
          )
          ensure(
            !event.notesRequired || !!body.note,
            400,
            'NOTE_REQUIRED',
            '请填写备注',
          )
          const previous = await tx.get<Registration>(
            'registrations',
            registrationId,
          )
          ensure(
            !previous?.checkedInAt,
            409,
            'ALREADY_CHECKED_IN',
            '已签到记录不能重新报名',
          )
          ensure(
            !previous || ['cancelled', 'rejected'].includes(previous.status),
            409,
            'ALREADY_REGISTERED',
            '请勿重复报名',
          )
          ensure(
            event.capacity === null || event.occupied < event.capacity,
            409,
            'EVENT_FULL',
            '报名已满',
          )
          const m = ctx.member
          const r: Registration = {
            id: registrationId,
            eventId: event.id,
            uid: m.uid,
            snapshot: {
              studentId: m.studentId,
              name: m.name,
              gender: m.gender,
              college: m.college,
              major: m.major,
              className: m.className,
              grade: m.grade,
            },
            note: body.note,
            status: event.approvalRequired ? 'pending' : 'approved',
            registeredAt: this.now(),
            updatedAt: this.now(),
          }
          await tx.set('registrations', r.id, r)
          if (!event.registrationIds.includes(r.id))
            event.registrationIds.push(r.id)
          event.occupied++
          await tx.set('events', event.id, event)
          await this.audit(tx, ctx, 'events.register', r.id)
          return { data: r }
        }
        if (action === 'registration' && method === 'DELETE') {
          ensure(
            event.allowCancellation && this.now() < event.registrationDeadline,
            409,
            'CANCELLATION_CLOSED',
            '不允许取消或已超过截止时间',
          )
          const r = await tx.get<Registration>('registrations', registrationId)
          ensure(
            r && ['pending', 'approved'].includes(r.status) && !r.checkedInAt,
            409,
            'CANNOT_CANCEL',
            '此报名不可取消',
          )
          await tx.set('registrations', r.id, {
            ...r,
            status: 'cancelled',
            updatedAt: this.now(),
          })
          event.occupied--
          await tx.set('events', event.id, event)
          await this.audit(tx, ctx, 'events.cancel', r.id)
          return { data: { ok: true } }
        }
        if (action === 'registrations' && method === 'GET') {
          const exporting = parts[3] === 'export.xlsx'
          if (exporting) this.scope(ctx, event, 'events.registrations.export')
          else
            ensure(
              this.access(ctx, event).roster,
              403,
              'EVENT_SCOPE',
              '未获此活动报名名单查看授权',
            )
          const page = await this.roster(
            event,
            exporting ? { ...q, page: '1', pageSize: '100' } : q,
          )
          let rows = page.items
          await this.audit(
            tx,
            ctx,
            parts[3] === 'export.xlsx'
              ? 'events.registrations.export'
              : 'events.registrations.read',
            event.id,
          )
          if (parts[3] === 'export.xlsx') {
            ensure(
              page.total <= 10000,
              413,
              'EXPORT_LIMIT',
              '导出最多10000条记录，请先按状态、姓名或学院筛选',
            )
            for (let nextPage = 2; rows.length < page.total; nextPage++) {
              const next = await this.roster(event, {
                ...q,
                page: String(nextPage),
                pageSize: '100',
              })
              if (!next.items.length) break
              rows = rows.concat(next.items)
            }
            const statuses = {
              pending: '待审核',
              approved: '已通过',
              rejected: '已拒绝',
              cancelled: '已取消',
              manual: '人工补签',
            }
            const binary = await exportWorkbook(
              [
                '序号',
                '学号',
                '姓名',
                '性别',
                '学院',
                '专业',
                '班级',
                '年级',
                '备注',
                '报名时间',
                '报名状态',
                '签到状态',
              ],
              rows.map((r, i) => [
                String(i + 1),
                r.snapshot.studentId,
                r.snapshot.name,
                r.snapshot.gender,
                r.snapshot.college,
                r.snapshot.major,
                r.snapshot.className,
                r.snapshot.grade,
                r.note,
                new Date(r.registeredAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                }),
                statuses[r.status],
                r.checkedInAt ? '已签到' : '未签到',
              ]),
            )
            return {
              binary,
              filename: `${[...event.title.replace(/[\\/:*?"<>|\r\n]/g, '_')].slice(0, 48).join('')}-报名签到名单-${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(this.clock()))}.xlsx`,
            }
          }
          return { data: page }
        }
        if (action === 'review' && method === 'POST') {
          this.scope(ctx, event, 'events.registrations.review')
          const body = z
            .object({
              uid: z.string().uuid(),
              status: z.enum(['approved', 'rejected']),
            })
            .strict()
            .parse(input)
          const r = await tx.get<Registration>(
            'registrations',
            `${event.id}:${body.uid}`,
          )
          ensure(
            r?.status === 'pending',
            409,
            'NOT_PENDING',
            '此记录不在待审核状态',
          )
          if (body.status === 'rejected') event.occupied--
          await tx.set('registrations', r.id, {
            ...r,
            status: body.status,
            reviewedBy: ctx.member.uid,
            updatedAt: this.now(),
          })
          await tx.set('events', event.id, event)
          await this.audit(tx, ctx, 'events.review', r.id)
          return { data: { ok: true } }
        }
        if (action === 'checkin-status' && method === 'GET') {
          this.scope(ctx, event, 'events.checkin.manage')
          const key = await tx.get<{ expiresAt: number }>(
            'system',
            `checkin:${event.id}`,
          )
          return {
            data: {
              enabled: event.checkinEnabled && event.status === 'published',
              open: !!(
                event.checkinEnabled &&
                event.status === 'published' &&
                event.checkinOpen &&
                key &&
                key.expiresAt > this.clock()
              ),
              expiresAt:
                key && key.expiresAt > 0
                  ? new Date(key.expiresAt).toISOString()
                  : null,
              ttlSeconds:
                event.checkinTtlSeconds ?? DEFAULT_CHECKIN_TTL_SECONDS,
            },
          }
        }
        if (action === 'checkin-code' && method === 'POST') {
          this.scope(ctx, event, 'events.checkin.manage')
          const body = z
            .object({
              open: z.boolean(),
              ttlSeconds: z
                .number()
                .int()
                .min(30)
                .max(MAX_CHECKIN_TTL_SECONDS)
                .optional(),
            })
            .strict()
            .parse(input)
          ensure(
            !body.open ||
              (event.checkinEnabled && event.status === 'published'),
            409,
            'CHECKIN_DISABLED',
            '此活动未启用签到',
          )
          const ttlSeconds =
            body.ttlSeconds ??
            event.checkinTtlSeconds ??
            DEFAULT_CHECKIN_TTL_SECONDS
          const code = body.open ? randomBytes(24).toString('base64url') : null
          event.checkinOpen = body.open
          event.checkinTtlSeconds = ttlSeconds
          event.updatedAt = this.now()
          await tx.set('events', event.id, event)
          await tx.set('system', `checkin:${event.id}`, {
            hash: code ? sha(code) : '',
            expiresAt: body.open ? this.clock() + ttlSeconds * 1000 : 0,
          })
          await this.audit(tx, ctx, 'events.checkin_code', event.id)
          return {
            data: {
              code,
              enabled: event.checkinEnabled && event.status === 'published',
              ttlSeconds,
              expiresAt: body.open
                ? new Date(this.clock() + ttlSeconds * 1000).toISOString()
                : null,
              open: body.open,
            },
          }
        }
        if (action === 'checkin' && method === 'POST') {
          const body = z
              .object({ code: z.string().min(1).max(200) })
              .strict()
              .parse(input),
            key = await tx.get<{ hash: string; expiresAt: number }>(
              'system',
              `checkin:${event.id}`,
            )
          ensure(
            event.status === 'published' &&
              event.checkinEnabled &&
              event.checkinOpen &&
              key &&
              key.expiresAt > this.clock() &&
              /^[a-f0-9]{64}$/.test(key.hash) &&
              timingSafeEqual(
                Buffer.from(key.hash, 'hex'),
                Buffer.from(sha(body.code), 'hex'),
              ),
            409,
            'INVALID_CHECKIN_CODE',
            '签到未开放或签到码已失效',
          )
          const r = await tx.get<Registration>('registrations', registrationId)
          ensure(
            r?.status === 'approved',
            403,
            'REGISTRATION_REQUIRED',
            '仅已通过报名的成员可签到',
          )
          if (!r.checkedInAt) {
            const checked = {
              ...r,
              checkedInAt: this.now(),
              checkinMethod: 'code' as const,
            }
            await tx.set('registrations', r.id, checked)
            await tx.set('checkins', r.id, {
              id: r.id,
              eventId: event.id,
              uid: r.uid,
              checkedInAt: checked.checkedInAt,
              method: 'code',
            })
            await this.audit(tx, ctx, 'events.checkin', r.id)
          }
          return { data: { ok: true } }
        }
        if (action === 'manual-checkin' && method === 'POST') {
          ensure(
            event.checkinEnabled && event.status === 'published',
            409,
            'CHECKIN_DISABLED',
            '此活动未启用签到',
          )
          this.scope(ctx, event, 'events.checkin.manage')
          const body = z
            .object({
              uid: z.string().uuid(),
              reason: z.string().trim().min(1).max(500),
            })
            .strict()
            .parse(input)
          const rid = `${event.id}:${body.uid}`
          const member = await tx.get<Member>('users', body.uid)
          ensure(
            member?.status === 'active',
            400,
            'INVALID_MEMBER',
            '补签对象须为有效成员',
          )
          let existing = await tx.get<Registration>('registrations', rid)
          if (!existing) {
            const m = await tx.get<Member>('users', body.uid)
            ensure(
              m?.status === 'active',
              400,
              'INVALID_MEMBER',
              '补签对象须为有效成员',
            )
            existing = {
              id: rid,
              eventId: event.id,
              uid: m.uid,
              snapshot: {
                studentId: m.studentId,
                name: m.name,
                gender: m.gender,
                college: m.college,
                major: m.major,
                className: m.className,
                grade: m.grade,
              },
              note: '管理员补签：' + body.reason,
              status: 'manual',
              registeredAt: this.now(),
              updatedAt: this.now(),
            }
            event.registrationIds.push(rid)
            await tx.set('events', event.id, event)
          }
          if (!existing.checkedInAt) {
            await tx.set('registrations', rid, {
              ...existing,
              status:
                existing.status === 'pending'
                  ? 'approved'
                  : ['cancelled', 'rejected'].includes(existing.status)
                    ? 'manual'
                    : existing.status,
              checkedInAt: this.now(),
              checkinMethod: 'manual',
              ...(existing.status === 'pending'
                ? { reviewedBy: ctx.member.uid }
                : {}),
              updatedAt: this.now(),
            })
            await tx.set('checkins', rid, {
              id: rid,
              eventId: event.id,
              uid: body.uid,
              checkedInAt: this.now(),
              method: 'manual',
              reason: body.reason,
              actor: ctx.member.uid,
            })
            await this.audit(tx, ctx, 'events.manual_checkin', rid)
          }
          return { data: { ok: true } }
        }
      }
      if (kind === 'articles') {
        if (!id && method === 'GET') {
          ensure(
            [
              'articles.create',
              'articles.edit',
              'articles.publish',
              'articles.delete',
            ].some((p) => this.can(ctx, p)),
            403,
            'FORBIDDEN',
            '没有文章权限',
          )
          return {
            data: await this.page(
              (
                await Promise.all(
                  cat.articles.map((id) =>
                    this.content<ClubArticle>(tx, 'articles', id),
                  ),
                )
              ).filter(
                (v) =>
                  v &&
                  v.status !== 'deleted' &&
                  (!q.search || v.title.includes(q.search)) &&
                  (!q.status || v.status === q.status) &&
                  (!q.category || v.category === q.category) &&
                  (this.can(ctx, 'articles.edit') ||
                    this.can(ctx, 'articles.publish') ||
                    this.can(ctx, 'articles.delete') ||
                    v.publisherUid === ctx.member.uid),
              ),
              q,
            ),
          }
        }
        const previous = id
          ? await this.content<ClubArticle>(tx, 'articles', id)
          : null
        if (id)
          ensure(
            previous && previous.status !== 'deleted',
            404,
            'NOT_FOUND',
            '文章不存在',
          )
        if (action === 'publish' && method === 'POST') {
          this.require(ctx, 'articles.publish')
          const body = z.object({ publish: z.boolean() }).strict().parse(input)
          const next = {
            ...previous!,
            status: body.publish
              ? ('published' as const)
              : ('withdrawn' as const),
            publishedAt:
              previous!.publishedAt ?? (body.publish ? this.now() : null),
            updatedAt: this.now(),
          }
          await tx.set('articles', id!, next)
          await this.audit(tx, ctx, 'articles.publish', id!)
          return { data: next }
        }
        if (method === 'DELETE') {
          this.require(ctx, 'articles.delete')
          await tx.set('articles', id!, {
            ...previous!,
            status: 'deleted',
            updatedAt: this.now(),
          })
          await this.audit(tx, ctx, 'articles.delete', id!)
          return { data: { ok: true } }
        }
        if (method === 'GET') {
          ensure(
            this.can(ctx, 'articles.edit') ||
              this.can(ctx, 'articles.publish') ||
              this.can(ctx, 'articles.delete') ||
              (this.can(ctx, 'articles.create') &&
                previous?.publisherUid === ctx.member.uid),
            403,
            'FORBIDDEN',
            '没有文章查看权限',
          )
          return { data: previous }
        }
        if (method === 'POST' || method === 'PATCH') {
          this.require(ctx, previous ? 'articles.edit' : 'articles.create')
          const body = articleSchema.parse(
            previous
              ? {
                  ...Object.fromEntries(
                    Object.keys(articleSchema.shape).map((key) => [
                      key,
                      (previous as unknown as Record<string, unknown>)[key],
                    ]),
                  ),
                  ...z.record(z.string(), z.unknown()).parse(input),
                }
              : input,
          )
          if (body.status === 'published' || previous?.status === 'published')
            this.require(ctx, 'articles.publish')
          const article: ClubArticle = {
            ...body,
            id: previous?.id ?? randomUUID(),
            publisherUid: previous?.publisherUid ?? ctx.member.uid,
            publisherName: previous?.publisherName ?? ctx.member.nickname,
            publishedAt:
              previous?.publishedAt ??
              (body.status === 'published' ? this.now() : null),
            createdAt: previous?.createdAt ?? this.now(),
            updatedAt: this.now(),
          }
          await syncMedia(
            tx,
            ctx,
            'articles',
            article.id,
            references(article.content, article.cover),
            references(previous?.content, previous?.cover),
          )
          await tx.set('articles', article.id, article)
          if (!previous) {
            cat.articles.push(article.id)
            await tx.set('system', 'stage3_catalog', cat)
          }
          await this.audit(tx, ctx, 'articles.save', article.id)
          return { data: article }
        }
      }
      if (kind === 'popups') {
        this.require(ctx, 'announcements.popup.manage')
        if (method === 'GET') {
          const current = await this.popup(tx)
          return {
            data: {
              current,
              items: (
                await Promise.all(
                  cat.popups.map((id) =>
                    tx.get<PopupAnnouncement>('popup_announcements', id),
                  ),
                )
              ).filter(Boolean),
            },
          }
        }
        if (method === 'POST') {
          const body = popupSchema.parse(input),
            target = await this.content<ClubEvent | ClubArticle>(
              tx,
              body.targetType === 'event' ? 'events' : 'articles',
              body.targetId,
            )
          ensure(
            target?.status === 'published',
            400,
            'UNPUBLISHED_TARGET',
            '请先发布关联内容',
          )
          const item: PopupAnnouncement = {
            ...body,
            id: randomUUID(),
            version: randomUUID(),
            enabled: true,
            state: 'scheduled',
            createdAt: this.now(),
            updatedAt: this.now(),
          }
          if (item.startsAt <= this.now()) await this.retireDue(tx, cat)
          cat.popups.push(item.id)
          await syncMedia(
            tx,
            ctx,
            'popup_announcements',
            item.id,
            references('', item.image),
            [],
            references('', target.cover),
          )
          await tx.set('popup_announcements', item.id, item)
          await tx.set('system', 'stage3_catalog', cat)
          await this.popup(tx)
          await this.audit(tx, ctx, 'popups.create', item.id)
          return {
            data: await tx.get<PopupAnnouncement>(
              'popup_announcements',
              item.id,
            ),
          }
        }
        if (id && method === 'PATCH') {
          const old = await tx.get<PopupAnnouncement>('popup_announcements', id)
          ensure(old, 404, 'NOT_FOUND', '弹窗不存在')
          const body = z.object({ enabled: z.boolean() }).strict().parse(input)
          if (body.enabled) {
            ensure(
              old.expiresAt > this.now(),
              409,
              'POPUP_EXPIRED',
              '公告已过期，请发布新版本',
            )
            if (old.startsAt <= this.now()) await this.retireDue(tx, cat, id)
          }
          await tx.set('popup_announcements', id, {
            ...old,
            enabled: body.enabled,
            state: body.enabled ? 'scheduled' : 'disabled',
            version: randomUUID(),
            createdAt: this.now(),
            updatedAt: this.now(),
          })
          await this.popup(tx)
          await this.audit(tx, ctx, 'popups.toggle', id)
          return { data: { ok: true } }
        }
      }
      throw new ApiError(404, 'NOT_FOUND', '接口不存在')
    }
    return publicRead
      ? this.store.run((tx) => work(tx))
      : this.secure(token, (tx, ctx) => work(tx, ctx))
  }
}
