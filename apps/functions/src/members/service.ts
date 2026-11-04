import { ForumService } from '../forum/service'
import { Stage3Service } from '../stage3/service'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  Member,
  Role,
  Permission,
  Identity,
  AuditLog,
  ImportJob,
} from '@electronic-club/shared'
import type { Store, Transaction } from './store'
import {
  ApiError,
  ensure,
  memberSchema,
  editSchema,
  profileSchema,
  passwordSchema,
  permissionDefinitions,
  roleSchema,
  listSchema,
  studentIdSchema,
} from './model'
import {
  digest,
  studentIdKey,
  randomToken,
  hashPassword,
  verifyPassword,
} from './crypto'
import { parseWorkbook } from './xlsx'
interface Control {
  initialized: boolean
  superAdminCount: number
  revision: number
}
interface Credential {
  hash: string
}
interface Session {
  uid: string
  version: number
  expiresAt: number
  idleExpiresAt: number
}
interface Context extends Identity {
  control: Control
  sessionId: string
}
interface Result {
  contentType?: string
  binary?: Buffer
  filename?: string
  status?: number
  data?: unknown
  error?: { code: string; message: string }
  token?: string
  clearCookie?: boolean
}
const failure = (status: number, code: string, message: string): Result => ({
  status,
  error: { code, message },
})
export class MemberService {
  constructor(
    public store: Store,
    private clock = () => Date.now(),
  ) {}
  private now() {
    return new Date(this.clock()).toISOString()
  }
  private async control(tx: Transaction) {
    const control = await tx.get<Control>('system', 'control')
    ensure(control?.initialized, 503, 'NOT_INITIALIZED', '成员系统尚未初始化')
    // All security mutations contend on one document: prevents write-skew for last-super and role use counts.
    control.revision++
    await tx.set('system', 'control', control)
    return control
  }
  private async audit(
    tx: Transaction,
    actor: string,
    action: string,
    target: string,
    fields: string[] = [],
  ) {
    const id = randomUUID()
    const log: AuditLog = {
      id,
      actor,
      action,
      target,
      fields,
      createdAt: this.now(),
    }
    await tx.set('audit_logs', id, log)
  }
  private async identity(tx: Transaction, user: Member): Promise<Identity> {
    const roles = await Promise.all(
      user.roleIds.map((id) => tx.get<Role>('roles', id)),
    )
    const permissions = [
      ...new Set(roles.flatMap((role) => role?.permissionIds ?? [])),
    ]
    return {
      roles: roles.flatMap((role) =>
        role ? [{ id: role.id, name: role.name }] : [],
      ),
      member: user,
      permissions,
      super: roles.some((role) => role?.super === true),
    }
  }
  private require(ctx: Identity, permission: string) {
    ensure(
      ctx.super || ctx.permissions.includes(permission),
      403,
      'FORBIDDEN',
      '没有执行此操作的权限',
    )
  }
  private async authenticate(
    tx: Transaction,
    token: string,
    control: Control,
    allowActivation = false,
  ): Promise<Context> {
    ensure(token, 401, 'UNAUTHENTICATED', '请先登录')
    const sessionId = digest(token)
    const session = await tx.get<Session>('sessions', sessionId)
    ensure(
      session &&
        session.expiresAt > this.clock() &&
        session.idleExpiresAt > this.clock(),
      401,
      'SESSION_EXPIRED',
      '会话已失效，请重新登录',
    )
    const user = await tx.get<Member>('users', session.uid)
    ensure(
      user && user.status === 'active' && user.version === session.version,
      401,
      'SESSION_REVOKED',
      '账号或会话已失效',
    )
    ensure(
      !user.mustChangePassword || allowActivation,
      403,
      'PASSWORD_CHANGE_REQUIRED',
      '请先修改初始密码',
    )
    if (user.mustChangePassword)
      ensure(
        Date.parse(user.activationExpiresAt) > this.clock(),
        401,
        'ACTIVATION_EXPIRED',
        '激活凭据已过期，请联系管理员重置',
      )
    session.idleExpiresAt = Math.min(
      session.expiresAt,
      this.clock() + 30 * 60_000,
    )
    await tx.set('sessions', sessionId, session)
    return { ...(await this.identity(tx, user)), control, sessionId }
  }
  private async secure<T>(
    token: string,
    fn: (tx: Transaction, ctx: Context) => Promise<T>,
    activation = false,
  ) {
    return this.store.run(async (tx) =>
      fn(
        tx,
        await this.authenticate(tx, token, await this.control(tx), activation),
      ),
    )
  }
  private async manageable(tx: Transaction, ctx: Context, user: Member) {
    const identity = await this.identity(tx, user)
    ensure(
      ctx.super ||
        (!identity.super &&
          identity.permissions.every((p) => ctx.permissions.includes(p))),
      403,
      'SCOPE_EXCEEDED',
      '不能管理权限高于自身的成员',
    )
  }
  private async adjustRoles(tx: Transaction, user: Member, newIds: string[]) {
    for (const id of new Set([...user.roleIds, ...newIds])) {
      const role = await tx.get<Role>('roles', id)
      ensure(role, 400, 'INVALID_ROLE', '角色不存在')
      role.memberCount +=
        Number(newIds.includes(id)) - Number(user.roleIds.includes(id))
      await tx.set('roles', id, role)
    }
  }
  private async protectLast(
    tx: Transaction,
    ctx: Context,
    user: Member,
    changes: Partial<Member>,
  ) {
    const was =
      (await this.identity(tx, user)).super && user.status === 'active'
    const next = { ...user, ...changes }
    const will =
      (await this.identity(tx, next)).super && next.status === 'active'
    const count = ctx.control.superAdminCount + Number(will) - Number(was)
    ensure(
      count >= 1,
      409,
      'LAST_SUPER_ADMIN',
      '不能删除、禁用或降级最后一个超级管理员',
    )
    ctx.control.superAdminCount = count
    await tx.set('system', 'control', ctx.control)
  }
  private async createMember(
    tx: Transaction,
    input: unknown,
    actor: string,
    password = '123456',
    roleIds = ['role_member'],
    mustChangePassword = true,
  ) {
    const data = memberSchema.parse(input)
    ensure(
      !(await tx.get('student_ids', studentIdKey(data.studentId))),
      409,
      'STUDENT_ID_EXISTS',
      '学号已存在（包括软删除账号）',
    )
    const uid = randomUUID()
    const now = this.now()
    const user: Member = {
      ...data,
      uid,
      nickname: data.nickname ?? data.name,
      roleIds,
      status: 'active',
      mustChangePassword,
      createdAt: now,
      updatedAt: now,
      version: 1,
      activationExpiresAt: new Date(this.clock() + 7 * 86400000).toISOString(),
    }
    await this.adjustRoles(tx, { ...user, roleIds: [] }, roleIds)
    await tx.set('users', uid, user)
    await tx.set('student_ids', studentIdKey(data.studentId), { uid })
    await tx.set('credentials', uid, { hash: await hashPassword(password) })
    await this.audit(tx, actor, 'members.create', uid, Object.keys(data))
    return user
  }
  async bootstrap(input: unknown, password: string) {
    const data = memberSchema.parse(input)
    passwordSchema.parse(password)
    return this.store.run(async (tx) => {
      ensure(
        !(await tx.get('system', 'control')),
        409,
        'ALREADY_INITIALIZED',
        '初始化已完成，拒绝重复初始化',
      )
      const now = this.now()
      for (const permission of permissionDefinitions)
        await tx.set('permissions', permission.id, {
          ...permission,
          createdAt: now,
        })
      const names = [
        '超级管理员',
        '管理员',
        '会长',
        '副会长',
        '部长',
        '副部长',
        '普通成员',
      ]
      const ids = [
        'role_super',
        'role_admin',
        'role_president',
        'role_vice_president',
        'role_head',
        'role_vice_head',
        'role_member',
      ]
      for (let i = 0; i < ids.length; i++) {
        const role: Role = {
          id: ids[i]!,
          name: names[i]!,
          description: '初始角色；社团职位另存于成员 position 字段',
          permissionIds:
            i === 0
              ? permissionDefinitions.map((p) => p.id)
              : i === 1
                ? permissionDefinitions
                    .filter((p) => p.implemented)
                    .map((p) => p.id)
                : [],
          memberCount: 0,
          builtin: true,
          super: i === 0,
          createdAt: now,
        }
        await tx.set('roles', role.id, role)
      }
      const user = await this.createMember(
        tx,
        data,
        'bootstrap',
        password,
        ['role_super'],
        false,
      )
      await tx.set('system', 'control', {
        initialized: true,
        superAdminCount: 1,
        revision: 1,
      })
      await this.audit(tx, 'bootstrap', 'system.initialize', user.uid)
      return user
    })
  }
  async login(input: unknown, ip: string): Promise<Result> {
    const body = z
      .object({
        studentId: studentIdSchema,
        password: z.string().min(1).max(128),
      })
      .strict()
      .parse(input)
    return this.store.run(async (tx) => {
      await this.control(tx)
      for (const [key, limit] of [
        [`account:${body.studentId}`, 10],
        [`ip:${ip}`, 200],
      ] as const) {
        const id = digest(key)
        let rate = await tx.get<{ count: number; until: number }>(
          'login_limits',
          id,
        )
        if (!rate || rate.until <= this.clock())
          rate = { count: 0, until: this.clock() + 15 * 60_000 }
        if (rate.count >= limit)
          return failure(
            429,
            'RATE_LIMITED',
            '登录尝试过于频繁，请15分钟后再试',
          )
        rate.count++
        await tx.set('login_limits', id, { ...rate, createdAt: this.now() })
      }
      const mapping = await tx.get<{ uid: string }>(
        'student_ids',
        studentIdKey(body.studentId),
      )
      const user = mapping ? await tx.get<Member>('users', mapping.uid) : null
      const credential = user
        ? await tx.get<Credential>('credentials', user.uid)
        : null
      const valid = await verifyPassword(body.password, credential?.hash ?? '')
      if (!user || user.status !== 'active' || !valid) {
        await this.audit(tx, 'anonymous', 'auth.login_failed', 'redacted')
        return failure(401, 'INVALID_CREDENTIALS', '学号、密码错误或账号不可用')
      }
      if (
        user.mustChangePassword &&
        Date.parse(user.activationExpiresAt) <= this.clock()
      )
        return failure(
          401,
          'ACTIVATION_EXPIRED',
          '初始凭据已过期，请联系管理员重置',
        )
      await tx.set('login_limits', digest(`account:${body.studentId}`), {
        count: 0,
        until: this.clock() + 15 * 60_000,
        createdAt: this.now(),
      })
      const token = randomToken()
      const expiresAt =
        this.clock() + (user.mustChangePassword ? 15 * 60_000 : 8 * 3600_000)
      await tx.set('sessions', digest(token), {
        createdAt: this.now(),
        uid: user.uid,
        version: user.version,
        expiresAt,
        idleExpiresAt: Math.min(expiresAt, this.clock() + 30 * 60_000),
      })
      await this.audit(tx, user.uid, 'auth.login', user.uid)
      return { data: await this.identity(tx, user), token }
    })
  }
  async authorize(token: string, permission: string) {
    return this.secure(token, async (_tx, ctx) => this.require(ctx, permission))
  }
  async prepareImport(token: string, input: unknown): Promise<Result> {
    const body = z
      .object({ file: z.string().min(1).max(3_000_000) })
      .strict()
      .parse(input)
    await this.secure(token, async (_tx, ctx) =>
      this.require(ctx, 'members.import'),
    )
    const file = Buffer.from(body.file, 'base64')
    const hash = digest(file.toString('base64'))
    const rows = await parseWorkbook(file)
    for (let start = 0; start < rows.length; start += 20)
      await Promise.all(
        rows.slice(start, start + 20).map(async (row) => {
          if (
            row.member &&
            !row.error &&
            (await this.store.read(
              'student_ids',
              studentIdKey(row.member.studentId),
            ))
          )
            row.error = '学号已存在（包括软删除账号）'
        }),
      )
    ensure(
      Buffer.byteLength(JSON.stringify(rows)) <= 700_000,
      413,
      'IMPORT_TOO_LARGE',
      '解析后数据过大，请拆分文件',
    )
    return this.secure(token, async (tx, ctx) => {
      this.require(ctx, 'members.import')
      const existing = await tx.get<ImportJob>('import_jobs', hash)
      if (existing) {
        ensure(
          existing.owner === ctx.member.uid || ctx.super,
          403,
          'FORBIDDEN',
          '该文件已由其他管理员导入',
        )
        return { data: existing }
      }
      const job: ImportJob = {
        id: hash,
        hash,
        owner: ctx.member.uid,
        rows,
        offset: 0,
        created: 0,
        skipped: 0,
        status: 'preview',
        createdAt: this.now(),
        updatedAt: this.now(),
      }
      await tx.set('import_jobs', hash, job)
      await this.audit(tx, ctx.member.uid, 'imports.preview', hash)
      return { data: job }
    })
  }
  async execute(
    token: string,
    method: string,
    path: string,
    input: unknown,
    query: Record<string, string>,
  ): Promise<Result> {
    if (/^\/api\/forum(?:\/|$)/.test(path))
      return new ForumService(
        this.store,
        (token, fn) => this.secure(token, fn),
        this.clock,
      ).execute(token, method, path, input, query)
    if (/^\/api\/(?:public|events|articles|popups)(?:\/|$)/.test(path))
      return new Stage3Service(
        this.store,
        (token, fn) => this.secure(token, fn),
        this.clock,
      ).execute(token, method, path, input, query)
    if (method === 'POST' && path === '/api/imports/preview')
      return this.prepareImport(token, input)
    return this.secure(
      token,
      async (tx, ctx) => {
        const user = ctx.member
        if (path === '/api/auth/me' && method === 'GET')
          return {
            data: {
              member: user,
              roles: ctx.roles,
              permissions: ctx.permissions,
              super: ctx.super,
            },
          }
        if (path === '/api/auth/logout' && method === 'POST') {
          await tx.remove('sessions', ctx.sessionId)
          await this.audit(tx, user.uid, 'auth.logout', user.uid)
          return { data: { ok: true }, clearCookie: true }
        }
        if (path === '/api/auth/password' && method === 'POST') {
          const body = z
            .object({
              oldPassword: z.string().max(128),
              newPassword: passwordSchema,
            })
            .strict()
            .parse(input)
          const credential = await tx.get<Credential>('credentials', user.uid)
          ensure(
            credential &&
              (await verifyPassword(body.oldPassword, credential.hash)),
            400,
            'WRONG_PASSWORD',
            '原密码错误',
          )
          ensure(
            body.oldPassword !== body.newPassword,
            400,
            'PASSWORD_UNCHANGED',
            '新密码不能与原密码相同',
          )
          await tx.set('credentials', user.uid, {
            hash: await hashPassword(body.newPassword),
          })
          await tx.set('users', user.uid, {
            ...user,
            mustChangePassword: false,
            version: user.version + 1,
            updatedAt: this.now(),
          })
          await this.audit(tx, user.uid, 'auth.password_change', user.uid)
          return { data: { ok: true }, clearCookie: true }
        }
        if (path === '/api/auth/revoke-sessions' && method === 'POST') {
          await tx.set('users', user.uid, {
            ...user,
            version: user.version + 1,
            updatedAt: this.now(),
          })
          await this.audit(tx, user.uid, 'auth.revoke_all', user.uid)
          return { data: { ok: true }, clearCookie: true }
        }
        if (path === '/api/profile' && method === 'PATCH') {
          const changes = profileSchema.parse(input)
          const next = { ...user, ...changes, updatedAt: this.now() }
          await tx.set('users', user.uid, next)
          await this.audit(
            tx,
            user.uid,
            'members.profile',
            user.uid,
            Object.keys(changes),
          )
          return { data: next }
        }
        if (path === '/api/members' && method === 'GET') {
          this.require(ctx, 'members.read')
          const options = listSchema.parse(query)
          const filter: Record<string, unknown> = {}
          if (options.status === 'all') filter._notDeleted = true
          else filter.status = options.status
          if (options.search) filter._search = options.search
          for (const key of ['college', 'className'] as const)
            if (options[key]) filter[key] = options[key]
          if (options.roleId) filter.roleIds = options.roleId
          const result = await this.store.list<Member>('users', filter, {
            offset: (options.page - 1) * options.pageSize,
            limit: options.pageSize,
          })
          return {
            data: { ...result, page: options.page, pageSize: options.pageSize },
          }
        }
        if (path === '/api/members' && method === 'POST') {
          this.require(ctx, 'members.create')
          return { data: await this.createMember(tx, input, user.uid) }
        }
        if (path === '/api/members/export' && method === 'GET') {
          this.require(ctx, 'members.export')
          this.require(ctx, 'members.read')
          const options = z
            .object({
              page: z.coerce.number().int().min(1).max(10000).default(1),
            })
            .strict()
            .parse(query)
          const result = await this.store.list<Member>(
            'users',
            { _notDeleted: true },
            { offset: (options.page - 1) * 100, limit: 100 },
          )
          await this.audit(tx, user.uid, 'members.export', 'users', [
            `page:${options.page}`,
          ])
          return { data: { ...result, page: options.page, pageSize: 100 } }
        }
        const memberMatch = path.match(
          /^\/api\/members\/([a-zA-Z0-9-]+)(?:\/(roles|password|status|restore|anonymize))?$/,
        )
        if (memberMatch) {
          const id = memberMatch[1]!
          const action = memberMatch[2]
          const target = await tx.get<Member>('users', id)
          ensure(target, 404, 'NOT_FOUND', '成员不存在')
          if (!action && method === 'GET') {
            this.require(ctx, 'members.read')
            return { data: target }
          }
          const required =
            action === 'roles'
              ? 'roles.assign'
              : action === 'password'
                ? 'members.password'
                : action === 'status'
                  ? 'members.status'
                  : action === 'restore' ||
                      action === 'anonymize' ||
                      method === 'DELETE'
                    ? 'members.delete'
                    : 'members.edit'
          this.require(ctx, required)
          await this.manageable(tx, ctx, target)
          let next = { ...target, updatedAt: this.now() }
          let fields: string[] = []
          if (!action && method === 'PATCH') {
            ensure(target.status !== 'deleted', 409, 'DELETED', '请先恢复成员')
            const changes = editSchema.parse(input)
            fields = Object.keys(changes)
            if (changes.studentId && changes.studentId !== target.studentId) {
              ensure(
                !(await tx.get('student_ids', studentIdKey(changes.studentId))),
                409,
                'STUDENT_ID_EXISTS',
                '学号已存在',
              )
              await tx.remove('student_ids', studentIdKey(target.studentId))
              await tx.set('student_ids', studentIdKey(changes.studentId), {
                uid: id,
              })
              next.version++
            }
            next = { ...next, ...changes }
          } else if (action === 'roles' && method === 'PUT') {
            ensure(target.status !== 'deleted', 409, 'DELETED', '请先恢复成员')
            const body = z
              .object({
                roleIds: z.array(z.string().min(1).max(64)).min(1).max(10),
              })
              .strict()
              .parse(input)
            const roleIds = [...new Set(body.roleIds)]
            for (const roleId of roleIds) {
              const role = await tx.get<Role>('roles', roleId)
              ensure(role, 400, 'INVALID_ROLE', '角色不存在')
              ensure(
                ctx.super ||
                  (!role.super &&
                    role.permissionIds.every((p) =>
                      ctx.permissions.includes(p),
                    )),
                403,
                'SCOPE_EXCEEDED',
                '不能分配超出自身权限的角色',
              )
            }
            await this.protectLast(tx, ctx, target, { roleIds })
            await this.adjustRoles(tx, target, roleIds)
            next.roleIds = roleIds
            next.version++
            fields = ['roleIds']
          } else if (action === 'password' && method === 'POST') {
            z.object({}).strict().parse(input)
            ensure(target.status !== 'deleted', 409, 'DELETED', '请先恢复成员')
            await tx.set('credentials', id, {
              hash: await hashPassword('123456'),
            })
            next.mustChangePassword = true
            next.activationExpiresAt = new Date(
              this.clock() + 7 * 86400000,
            ).toISOString()
            next.version++
            fields = ['credentials']
          } else if (action === 'status' && method === 'PATCH') {
            const body = z
              .object({ status: z.enum(['active', 'disabled']) })
              .strict()
              .parse(input)
            ensure(
              target.status !== 'deleted',
              409,
              'DELETED',
              '请使用恢复操作',
            )
            await this.protectLast(tx, ctx, target, body)
            next.status = body.status
            next.version++
            fields = ['status']
          } else if (action === 'restore' && method === 'POST') {
            ensure(
              target.status === 'deleted' && !target.anonymizedAt,
              409,
              'NOT_RESTORABLE',
              '账号不可恢复',
            )
            // Restore as disabled; activation is a separate, audited status operation.
            next.status = 'disabled'
            delete next.deletedAt
            next.version++
            fields = ['status']
          } else if (!action && method === 'DELETE') {
            await this.protectLast(tx, ctx, target, { status: 'deleted' })
            next.status = 'deleted'
            next.deletedAt = this.now()
            next.version++
            fields = ['status', 'deletedAt']
          } else if (action === 'anonymize' && method === 'POST') {
            ensure(
              ctx.super && target.status === 'deleted',
              403,
              'FORBIDDEN',
              '仅超级管理员可以匿名化已软删除成员',
            )
            ensure(
              !target.anonymizedAt,
              409,
              'ALREADY_ANONYMIZED',
              '已经匿名化',
            )
            await tx.set('privacy_jobs', id, {
              id,
              uid: id,
              studentIdDigest: studentIdKey(target.studentId),
              status: 'pending',
              createdAt: this.now(),
            })
            await this.adjustRoles(tx, target, [])
            await tx.remove('student_ids', studentIdKey(target.studentId))
            await tx.remove('credentials', id)
            next = {
              ...next,
              studentId: '',
              name: '已匿名化',
              nickname: '已匿名化',
              gender: '未填写',
              college: '',
              major: '',
              className: '',
              grade: '',
              phone: '',
              email: '',
              avatar: '',
              position: '',
              roleIds: [],
              anonymizedAt: this.now(),
              version: next.version + 1,
            }
            fields = ['personalData']
          } else throw new ApiError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
          await tx.set('users', id, next)
          await this.audit(
            tx,
            user.uid,
            `members.${action ?? (method === 'DELETE' ? 'delete' : 'edit')}`,
            id,
            fields,
          )
          return { data: next }
        }
        const accessRoster = path.match(
          /^\/api\/(roles|permissions)\/([a-zA-Z0-9_.-]+)\/members$/,
        )
        if (accessRoster && method === 'GET') {
          this.require(ctx, 'roles.read')
          this.require(ctx, 'members.read')
          const [, scope, id] = accessRoster
          ensure(await tx.get(scope, id), 404, 'NOT_FOUND', '角色或权限不存在')
          const options = z
            .object({
              page: z.coerce.number().int().min(1).max(10000).default(1),
              pageSize: z.coerce.number().int().min(1).max(50).default(20),
              search: z.string().max(80).default(''),
              status: z
                .enum(['active', 'disabled', 'deleted', 'all'])
                .default(scope === 'roles' ? 'all' : 'active'),
            })
            .strict()
            .parse(query)
          const result = await this.store.list(
            'access_members',
            {
              [scope === 'roles' ? 'roleId' : 'permissionId']: id,
              search: options.search,
              status: options.status,
            },
            {
              offset: (options.page - 1) * options.pageSize,
              limit: options.pageSize,
            },
          )
          return {
            data: { ...result, page: options.page, pageSize: options.pageSize },
          }
        }
        if (path === '/api/roles/member-lookup' && method === 'GET') {
          this.require(ctx, 'roles.read')
          this.require(ctx, 'members.read')
          this.require(ctx, 'roles.assign')
          const { studentId } = z
            .object({ studentId: studentIdSchema })
            .strict()
            .parse(query)
          const index = await tx.get<{ uid: string }>(
            'student_ids',
            studentIdKey(studentId),
          )
          const target = index
            ? await tx.get<Member>('users', index.uid)
            : undefined
          ensure(
            target && target.status !== 'deleted',
            404,
            'NOT_FOUND',
            '未找到可分配角色的成员',
          )
          await this.manageable(tx, ctx, target)
          const roles = await Promise.all(
            target.roleIds.map(async (id) => {
              const r = await tx.get<Role>('roles', id)
              return { id, name: r?.name ?? id, super: !!r?.super }
            }),
          )
          return {
            data: {
              uid: target.uid,
              studentId: target.studentId,
              name: target.name,
              nickname: target.nickname,
              status: target.status,
              roleIds: target.roleIds,
              roles,
              sources: [],
            },
          }
        }
        const accessChange = path.match(
          /^\/api\/roles\/([a-zA-Z0-9_-]+)\/members\/([a-zA-Z0-9-]+)$/,
        )
        if (accessChange && method === 'POST') {
          this.require(ctx, 'roles.read')
          this.require(ctx, 'roles.assign')
          const [, roleId, uid] = accessChange
          const body = z
            .object({
              action: z.enum(['add', 'remove']),
              replacementRoleId: z.string().min(1).max(64).optional(),
            })
            .strict()
            .parse(input)
          ensure(
            body.action === 'remove' || !body.replacementRoleId,
            400,
            'INVALID_INPUT',
            '添加角色时无需替代角色',
          )
          const target = await tx.get<Member>('users', uid)
          ensure(
            target && target.status !== 'deleted',
            404,
            'NOT_FOUND',
            '成员不存在或已删除',
          )
          await this.manageable(tx, ctx, target)
          for (const id of [
            roleId,
            ...(body.replacementRoleId ? [body.replacementRoleId] : []),
          ]) {
            const role = await tx.get<Role>('roles', id)
            ensure(role, 400, 'INVALID_ROLE', '角色不存在')
            ensure(
              ctx.super ||
                (!role.super &&
                  role.permissionIds.every((p) => ctx.permissions.includes(p))),
              403,
              'SCOPE_EXCEEDED',
              '不能分配或移除超出自身权限的角色',
            )
          }
          const has = target.roleIds.includes(roleId)
          if (has === (body.action === 'add'))
            return { data: { uid, changed: false, roleIds: target.roleIds } }
          ensure(
            body.replacementRoleId !== roleId,
            400,
            'INVALID_ROLE',
            '替代角色不能与移除的角色相同',
          )
          const roleIds =
            body.action === 'add'
              ? [...target.roleIds, roleId]
              : [
                  ...new Set([
                    ...target.roleIds.filter((id) => id !== roleId),
                    ...(body.replacementRoleId ? [body.replacementRoleId] : []),
                  ]),
                ]
          await this.protectLast(tx, ctx, target, { roleIds })
          ensure(
            roleIds.length >= 1 && roleIds.length <= 10,
            400,
            'INVALID_ROLES',
            '成员需保留 1 至 10 个角色，请选择替代角色',
          )
          await this.adjustRoles(tx, target, roleIds)
          await tx.set('users', uid, {
            ...target,
            roleIds,
            version: target.version + 1,
            updatedAt: new Date(this.clock()).toISOString(),
          })
          await this.audit(tx, user.uid, `roles.members.${body.action}`, uid, [
            `role:${roleId}`,
            ...(body.replacementRoleId
              ? [`replacement:${body.replacementRoleId}`]
              : []),
          ])
          return { data: { uid, changed: true, roleIds } }
        }
        if (path === '/api/permissions' && method === 'GET') {
          this.require(ctx, 'roles.read')
          return {
            data: (
              await this.store.list<Permission>(
                'permissions',
                {},
                { offset: 0, limit: 100 },
              )
            ).items,
          }
        }
        if (path === '/api/roles' && method === 'GET') {
          this.require(ctx, 'roles.read')
          const page = z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .parse(query.page ?? 1)
          const result = await this.store.list<Role>(
            'roles',
            {},
            { offset: (page - 1) * 100, limit: 100 },
          )
          return { data: { ...result, page, pageSize: 100 } }
        }
        if (
          (path === '/api/roles' && method === 'POST') ||
          /^\/api\/roles\/[a-zA-Z0-9_-]+$/.test(path)
        ) {
          this.require(ctx, 'roles.manage')
          const id = path.split('/')[3] ?? randomUUID()
          const previous = await tx.get<Role>('roles', id)
          if (method !== 'POST')
            ensure(previous, 404, 'NOT_FOUND', '角色不存在')
          if (previous)
            ensure(
              !previous.super &&
                (ctx.super ||
                  previous.permissionIds.every((p) =>
                    ctx.permissions.includes(p),
                  )),
              403,
              'SCOPE_EXCEEDED',
              '此角色超出可管理范围',
            )
          if (method === 'DELETE') {
            ensure(
              previous && !previous.builtin && previous.memberCount === 0,
              409,
              'ROLE_IN_USE',
              '初始角色或仍被成员使用的角色不可删除',
            )
            await tx.remove('roles', id)
            await this.audit(tx, user.uid, 'roles.delete', id)
            return { data: { ok: true } }
          }
          ensure(
            method === 'POST' || method === 'PUT',
            405,
            'METHOD_NOT_ALLOWED',
            '方法不支持',
          )
          ensure(
            !(method === 'POST' && path !== '/api/roles'),
            405,
            'METHOD_NOT_ALLOWED',
            '方法不支持',
          )
          const data = roleSchema.parse(input)
          ensure(
            data.name !== '超级管理员',
            400,
            'RESERVED_ROLE_NAME',
            '超级管理员为保留角色名称',
          )
          for (const permission of data.permissionIds) {
            ensure(
              await tx.get('permissions', permission),
              400,
              'INVALID_PERMISSION',
              '权限不存在',
            )
            ensure(
              ctx.super || ctx.permissions.includes(permission),
              403,
              'SCOPE_EXCEEDED',
              '不能授予超出自身的权限',
            )
          }
          const role: Role = {
            ...data,
            id,
            builtin: previous?.builtin ?? false,
            super: false,
            memberCount: previous?.memberCount ?? 0,
            createdAt: previous?.createdAt ?? this.now(),
          }
          await tx.set('roles', id, role)
          await this.audit(
            tx,
            user.uid,
            previous ? 'roles.edit' : 'roles.create',
            id,
            ['name', 'description', 'permissionIds'],
          )
          return { data: role }
        }
        const jobMatch = path.match(
          /^\/api\/imports\/([a-f0-9]{64})(?:\/(process))?$/,
        )
        if (jobMatch) {
          this.require(ctx, 'members.import')
          const job = await tx.get<ImportJob>('import_jobs', jobMatch[1]!)
          ensure(job, 404, 'NOT_FOUND', '导入任务不存在')
          ensure(
            job.owner === user.uid || ctx.super,
            403,
            'FORBIDDEN',
            '不能读取他人的导入任务',
          )
          if (method === 'GET' && !jobMatch[2]) return { data: job }
          ensure(
            method === 'POST' && jobMatch[2] === 'process',
            405,
            'METHOD_NOT_ALLOWED',
            '方法不支持',
          )
          const body = z
            .object({ offset: z.number().int().min(0) })
            .strict()
            .parse(input)
          if (body.offset !== job.offset || job.status === 'completed')
            return { data: job }
          const end = Math.min(job.offset + 20, job.rows.length)
          for (let i = job.offset; i < end; i++) {
            const row = job.rows[i]!
            if (!row.error && row.member) {
              if (
                await tx.get('student_ids', studentIdKey(row.member.studentId))
              )
                row.error = '学号已存在或被其他任务创建'
              else
                row.uid = (
                  await this.createMember(tx, row.member, user.uid)
                ).uid
            }
            if (row.uid) job.created++
            else job.skipped++
          }
          job.offset = end
          job.status = end === job.rows.length ? 'completed' : 'processing'
          job.updatedAt = this.now()
          await tx.set('import_jobs', job.id, job)
          await this.audit(tx, user.uid, 'members.import', job.id, [
            `offset:${body.offset}`,
            `created:${job.created}`,
            `skipped:${job.skipped}`,
          ])
          return { data: job }
        }
        if (path === '/api/audit' && method === 'GET') {
          this.require(ctx, 'audit.read')
          const page = z.coerce
            .number()
            .int()
            .min(1)
            .max(10000)
            .parse(query.page ?? 1)
          const result = await this.store.list<AuditLog>(
            'audit_logs',
            {},
            { offset: (page - 1) * 50, limit: 50 },
          )
          return { data: { ...result, page, pageSize: 50 } }
        }
        throw new ApiError(404, 'NOT_FOUND', '接口不存在')
      },
      ['/api/auth/me', '/api/auth/logout', '/api/auth/password'].includes(path),
    )
  }
}
