import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { createHandler } from '../apps/functions/src/index'
import { parseWorkbook, columns } from '../apps/functions/src/members/xlsx'
import type {
  Member,
  Identity,
  Role,
  ImportJob,
  ApiResponse,
  Page,
  AuditLog,
} from '../packages/shared/src/index'
process.env.ALLOWED_ORIGIN = 'http://localhost:5173'
process.env.COOKIE_SECURE = 'false'
const rootPassword = 'Root-Test-Password123'
const memberPassword = 'Member-Test-Password123'
async function fixture() {
  let now = Date.now()
  const store = new MemoryStore(),
    service = new MemberService(store, () => now)
  const root = await service.bootstrap(
    { studentId: '00000001', name: '测试超级管理员' },
    rootPassword,
  )
  const handler = createHandler(() => service)
  async function call<T>(
    method: string,
    path: string,
    data: unknown = {},
    cookie = '',
    extra: Record<string, string> = {},
  ) {
    const url = new URL(path, 'http://localhost')
    const response = await handler({
      path: url.pathname,
      httpMethod: method,
      body: method === 'GET' ? undefined : JSON.stringify(data),
      headers: {
        origin: process.env.ALLOWED_ORIGIN,
        'content-type': 'application/json',
        'x-requested-with': 'ElectronicClub',
        cookie,
        ...extra,
      },
      queryStringParameters: Object.fromEntries(url.searchParams),
      requestContext: { sourceIp: '127.0.0.1' },
    })
    const body = response.isBase64Encoded
      ? null
      : (JSON.parse(response.body) as ApiResponse<T>)
    return {
      response,
      body,
      data: body?.success ? body.data : undefined,
      cookie: response.headers['Set-Cookie']?.split(';')[0] ?? '',
    }
  }
  async function login(studentId: string, password: string) {
    return call<Identity>('POST', '/api/auth/login', { studentId, password })
  }
  const rootLogin = await login(root.studentId, rootPassword)
  assert.equal(rootLogin.response.statusCode, 200)
  const cookie = rootLogin.cookie
  async function create(studentId = '00001234') {
    const result = await call<Member>(
      'POST',
      '/api/members',
      { studentId, name: '测试成员' },
      cookie,
    )
    assert.equal(result.response.statusCode, 200)
    return result.data!
  }
  async function activate(user: Member) {
    const initial = await login(user.studentId, '123456')
    assert.equal(initial.response.statusCode, 200)
    assert.equal(
      (
        await call(
          'POST',
          '/api/auth/password',
          { oldPassword: '123456', newPassword: memberPassword },
          initial.cookie,
        )
      ).response.statusCode,
      200,
    )
    return (await login(user.studentId, memberPassword)).cookie
  }
  return {
    store,
    service,
    root,
    call,
    login,
    cookie,
    create,
    activate,
    advance: (ms: number) => {
      now += ms
    },
  }
}
async function workbook(rows: unknown[][]) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('成员')
  sheet.addRow(columns)
  sheet.getColumn(1).numFmt = '@'
  rows.forEach((row) => sheet.addRow(row))
  return Buffer.from(await book.xlsx.writeBuffer())
}
test('login success, wrong password, anonymous protection, HttpOnly session and CSRF', async () => {
  const f = await fixture()
  assert.equal((await f.login('00000001', 'wrong')).response.statusCode, 401)
  assert.equal((await f.call('GET', '/api/members')).response.statusCode, 401)
  const response = await f.login('00000001', rootPassword)
  assert.match(
    response.response.headers['Set-Cookie']!,
    /HttpOnly; SameSite=Lax/,
  )
  assert.equal(
    (
      await f.call('POST', '/api/members', {}, f.cookie, {
        origin: 'https://evil.example',
      })
    ).response.statusCode,
    403,
  )
  assert.equal(
    (await f.call<Identity>('GET', '/api/auth/me', {}, f.cookie)).data?.member
      .uid,
    f.root.uid,
  )
})
test('initial login is restricted; password change revokes initial session', async () => {
  const f = await fixture(),
    user = await f.create()
  const first = await f.login(user.studentId, '123456')
  assert.equal(first.data?.member.mustChangePassword, true)
  assert.equal(
    (await f.call('GET', '/api/members', {}, first.cookie)).response.statusCode,
    403,
  )
  assert.equal(
    (
      await f.call(
        'PATCH',
        '/api/profile',
        { nickname: '越过改密' },
        first.cookie,
      )
    ).response.statusCode,
    403,
  )
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/auth/password',
        { oldPassword: '123456', newPassword: memberPassword },
        first.cookie,
      )
    ).response.statusCode,
    200,
  )
  assert.equal(
    (await f.call('GET', '/api/auth/me', {}, first.cookie)).response.statusCode,
    401,
  )
  assert.equal(
    (await f.login(user.studentId, memberPassword)).data?.member
      .mustChangePassword,
    false,
  )
})
test('ordinary member cannot modify identity, roles, status, or admin endpoints', async () => {
  const f = await fixture(),
    user = await f.create(),
    cookie = await f.activate(user)
  for (const body of [
    { name: '篡改姓名' },
    { studentId: '99999999' },
    { roleIds: ['role_super'] },
    { status: 'active' },
  ])
    assert.equal(
      (await f.call('PATCH', '/api/profile', body, cookie)).response.statusCode,
      400,
    )
  assert.equal(
    (await f.call('PATCH', '/api/profile', { nickname: '允许昵称' }, cookie))
      .response.statusCode,
    200,
  )
  const routes: [string, string, unknown][] = [
    ['GET', '/api/members', {}],
    ['POST', '/api/members', { studentId: '99998888', name: '无权限' }],
    ['GET', `/api/members/${user.uid}`, {}],
    ['PATCH', `/api/members/${user.uid}`, { name: '越权' }],
    ['PUT', `/api/members/${user.uid}/roles`, { roleIds: ['role_super'] }],
    ['POST', `/api/members/${user.uid}/password`, {}],
    ['PATCH', `/api/members/${user.uid}/status`, { status: 'disabled' }],
    ['DELETE', `/api/members/${user.uid}`, {}],
    ['POST', `/api/members/${user.uid}/restore`, {}],
    ['POST', `/api/members/${user.uid}/anonymize`, {}],
    ['GET', '/api/members/export', {}],
    ['GET', '/api/members/export.xlsx', {}],
    ['GET', '/api/roles', {}],
    ['GET', '/api/permissions', {}],
    [
      'POST',
      '/api/roles',
      { name: '越权', description: '', permissionIds: [] },
    ],
    ['GET', '/api/imports/template', {}],
    ['POST', '/api/imports/preview', { file: 'AAAA' }],
    ['GET', '/api/audit', {}],
    [
      'PUT',
      '/api/roles/role_member',
      { name: '越权', description: '', permissionIds: [] },
    ],
    ['DELETE', '/api/roles/role_member', {}],
    ['GET', `/api/imports/${'a'.repeat(64)}`, {}],
    ['POST', `/api/imports/${'a'.repeat(64)}/process`, { offset: 0 }],
    ['GET', `/api/imports/${'a'.repeat(64)}/errors.xlsx`, {}],
  ]
  for (const [method, path, body] of routes)
    assert.equal(
      (await f.call(method, path, body, cookie)).response.statusCode,
      403,
      `${method} ${path}`,
    )
})
test('studentId uniqueness includes deleted accounts and default nickname is real name', async () => {
  const f = await fixture(),
    user = await f.create()
  assert.equal(user.nickname, user.name)
  assert.equal(user.studentId, '00001234')
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/members',
        { studentId: user.studentId, name: '重复' },
        f.cookie,
      )
    ).response.statusCode,
    409,
  )
  await f.call('DELETE', `/api/members/${user.uid}`, {}, f.cookie)
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/members',
        { studentId: user.studentId, name: '重复' },
        f.cookie,
      )
    ).response.statusCode,
    409,
  )
})
test('XLSX preserves leading zeros; rejects numeric IDs, formulas and duplicates', async () => {
  const rows = await parseWorkbook(
    await workbook([
      ['001234', '甲', '男', '学院', '专业', '班级', '2024'],
      [1234, '乙'],
      ['001234', '丙'],
      [{ formula: '1+2' }, '丁'],
    ]),
  )
  assert.equal(rows[0]?.member?.studentId, '001234')
  assert.match(rows[1]!.error!, /文本/)
  assert.match(rows[2]!.error!, /重复/)
  assert.match(rows[3]!.error!, /文本/)
})
test('import preview checks existing IDs, repeats are idempotent and errors export as XLSX', async () => {
  const f = await fixture()
  await f.create('009999')
  const file = (
    await workbook([
      ['001234', '甲'],
      ['001234', '重复'],
      ['009999', '已存在'],
      ['005678', '乙'],
    ])
  ).toString('base64')
  const first = await f.call<ImportJob>(
    'POST',
    '/api/imports/preview',
    { file },
    f.cookie,
  )
  assert.equal(first.response.statusCode, 200)
  const id = first.data!.id
  assert.match(first.data!.rows[2]!.error!, /已存在/)
  assert.equal(
    (
      await f.call<ImportJob>(
        'POST',
        '/api/imports/preview',
        { file },
        f.cookie,
      )
    ).data!.id,
    id,
  )
  const jobs = await Promise.all([
    f.call<ImportJob>(
      'POST',
      `/api/imports/${id}/process`,
      { offset: 0 },
      f.cookie,
    ),
    f.call<ImportJob>(
      'POST',
      `/api/imports/${id}/process`,
      { offset: 0 },
      f.cookie,
    ),
  ])
  for (const result of jobs) {
    assert.equal(result.data?.created, 2)
    assert.equal(result.data?.skipped, 2)
    assert.equal(result.data?.status, 'completed')
  }
  const again = await f.call<ImportJob>(
    'POST',
    '/api/imports/preview',
    { file },
    f.cookie,
  )
  assert.equal(again.data?.created, 2)
  const exported = await f.call(
    'GET',
    `/api/imports/${id}/errors.xlsx`,
    {},
    f.cookie,
  )
  assert.equal(exported.response.isBase64Encoded, true)
  const users = await f.call<Page<Member>>(
    'GET',
    '/api/members?status=all',
    {},
    f.cookie,
  )
  assert.equal(users.data?.total, 4)
})
test('reset password revokes old sessions and forces activation; disabled accounts fail requests', async () => {
  const f = await fixture(),
    user = await f.create(),
    cookie = await f.activate(user)
  assert.equal(
    (await f.call('POST', `/api/members/${user.uid}/password`, {}, f.cookie))
      .response.statusCode,
    200,
  )
  assert.equal(
    (await f.call('GET', '/api/auth/me', {}, cookie)).response.statusCode,
    401,
  )
  assert.equal(
    (await f.login(user.studentId, memberPassword)).response.statusCode,
    401,
  )
  const reset = await f.login(user.studentId, '123456')
  assert.equal(reset.data?.member.mustChangePassword, true)
  assert.equal(
    (
      await f.call(
        'PATCH',
        `/api/members/${user.uid}/status`,
        { status: 'disabled' },
        f.cookie,
      )
    ).response.statusCode,
    200,
  )
  assert.equal(
    (await f.call('GET', '/api/auth/me', {}, reset.cookie)).response.statusCode,
    401,
  )
  assert.equal(
    (await f.login(user.studentId, '123456')).response.statusCode,
    401,
  )
})
test('multiple roles merge permissions and changes take effect in existing sessions', async () => {
  const f = await fixture(),
    user = await f.create()
  const read = await f.call<Role>(
    'POST',
    '/api/roles',
    { name: '查询角色', description: '', permissionIds: ['members.read'] },
    f.cookie,
  )
  const exp = await f.call<Role>(
    'POST',
    '/api/roles',
    { name: '导出角色', description: '', permissionIds: ['members.export'] },
    f.cookie,
  )
  await f.call(
    'PUT',
    `/api/members/${user.uid}/roles`,
    { roleIds: [read.data!.id, exp.data!.id] },
    f.cookie,
  )
  const cookie = await f.activate(user)
  const me = await f.call<Identity>('GET', '/api/auth/me', {}, cookie)
  assert.deepEqual(
    new Set(me.data!.permissions),
    new Set(['members.read', 'members.export']),
  )
  await f.call(
    'PUT',
    `/api/roles/${read.data!.id}`,
    { name: '查询角色', description: '', permissionIds: [] },
    f.cookie,
  )
  assert.equal(
    (await f.call('GET', '/api/members', {}, cookie)).response.statusCode,
    403,
  )
  assert.equal(
    (await f.call('DELETE', `/api/roles/${exp.data!.id}`, {}, f.cookie))
      .response.statusCode,
    409,
  )
})
test('ordinary administrator cannot self-promote, reset super admin, or create excessive roles', async () => {
  const f = await fixture(),
    user = await f.create()
  await f.call(
    'PUT',
    `/api/members/${user.uid}/roles`,
    { roleIds: ['role_admin'] },
    f.cookie,
  )
  const cookie = await f.activate(user)
  assert.equal(
    (
      await f.call(
        'PUT',
        `/api/members/${user.uid}/roles`,
        { roleIds: ['role_super'] },
        cookie,
      )
    ).response.statusCode,
    403,
  )
  assert.equal(
    (await f.call('POST', `/api/members/${f.root.uid}/password`, {}, cookie))
      .response.statusCode,
    403,
  )
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/roles',
        {
          name: '越权角色',
          description: '',
          permissionIds: ['settings.manage'],
        },
        cookie,
      )
    ).response.statusCode,
    403,
  )
})
test('last super admin survives deletion, disabling, demotion, and concurrent mutations', async () => {
  const f = await fixture()
  const results = await Promise.all([
    f.call('DELETE', `/api/members/${f.root.uid}`, {}, f.cookie),
    f.call(
      'PATCH',
      `/api/members/${f.root.uid}/status`,
      { status: 'disabled' },
      f.cookie,
    ),
    f.call(
      'PUT',
      `/api/members/${f.root.uid}/roles`,
      { roleIds: ['role_member'] },
      f.cookie,
    ),
  ])
  results.forEach((result) => assert.equal(result.response.statusCode, 409))
  await assert.rejects(() =>
    f.service.bootstrap(
      { studentId: '00000002', name: '重复初始化' },
      rootPassword,
    ),
  )
})
test('rate limits persist failures, logout/revoke and idle expiry invalidate sessions', async () => {
  const f = await fixture()
  for (let i = 0; i < 10; i++)
    assert.equal((await f.login('00999999', 'wrong')).response.statusCode, 401)
  assert.equal((await f.login('00999999', 'wrong')).response.statusCode, 429)
  await f.call('POST', '/api/auth/logout', {}, f.cookie)
  assert.equal(
    (await f.call('GET', '/api/auth/me', {}, f.cookie)).response.statusCode,
    401,
  )
  const cookie = (await f.login(f.root.studentId, rootPassword)).cookie
  await f.call('POST', '/api/auth/revoke-sessions', {}, cookie)
  assert.equal(
    (await f.call('GET', '/api/auth/me', {}, cookie)).response.statusCode,
    401,
  )
  const next = (await f.login(f.root.studentId, rootPassword)).cookie
  f.advance(31 * 60_000)
  assert.equal(
    (await f.call('GET', '/api/auth/me', {}, next)).response.statusCode,
    401,
  )
})
test('member mutation audit excludes passwords, soft deletion restores disabled and anonymization is final', async () => {
  const f = await fixture(),
    user = await f.create()
  await f.call(
    'PATCH',
    `/api/members/${user.uid}`,
    { name: '更正身份' },
    f.cookie,
  )
  await f.call('DELETE', `/api/members/${user.uid}`, {}, f.cookie)
  const restore = await f.call<Member>(
    'POST',
    `/api/members/${user.uid}/restore`,
    {},
    f.cookie,
  )
  assert.equal(restore.data?.status, 'disabled')
  await f.call('DELETE', `/api/members/${user.uid}`, {}, f.cookie)
  const anon = await f.call<Member>(
    'POST',
    `/api/members/${user.uid}/anonymize`,
    {},
    f.cookie,
  )
  assert.equal(anon.data?.studentId, '')
  assert.ok(anon.data?.anonymizedAt)
  assert.equal(
    (await f.call('POST', `/api/members/${user.uid}/restore`, {}, f.cookie))
      .response.statusCode,
    409,
  )
  const logs = await f.call<Page<AuditLog>>('GET', '/api/audit', {}, f.cookie)
  for (const action of [
    'members.create',
    'members.edit',
    'members.delete',
    'members.restore',
    'members.anonymize',
  ])
    assert.ok(logs.data?.items.some((log) => log.action === action))
  assert.ok(!JSON.stringify(logs.data).includes(rootPassword))
  assert.ok(!JSON.stringify(logs.data).includes('123456'))
  const credentials = await f.store.read<{ hash: string }>(
    'credentials',
    f.root.uid,
  )
  assert.match(credentials!.hash, /^scrypt\$/)
})

test('partial updates retain untouched data and multi-batch imports reject stale offsets', async () => {
  const f = await fixture()
  const created = await f.call<Member>(
    'POST',
    '/api/members',
    {
      studentId: '00912345',
      name: '原名',
      college: '真实学院',
      phone: '13800000000',
    },
    f.cookie,
  )
  const edited = await f.call<Member>(
    'PATCH',
    `/api/members/${created.data!.uid}`,
    { name: '更正姓名' },
    f.cookie,
  )
  assert.equal(edited.data?.college, '真实学院')
  assert.equal(edited.data?.phone, '13800000000')
  const rows = Array.from({ length: 21 }, (_, i) => [
    String(80000000 + i),
    '分批成员' + i,
  ])
  const preview = await f.call<ImportJob>(
    'POST',
    '/api/imports/preview',
    { file: (await workbook(rows)).toString('base64') },
    f.cookie,
  )
  const path = `/api/imports/${preview.data!.id}/process`
  const first = await f.call<ImportJob>('POST', path, { offset: 0 }, f.cookie)
  assert.equal(first.data?.created, 20)
  assert.equal(first.data?.status, 'processing')
  assert.equal(
    (await f.call<ImportJob>('POST', path, { offset: 0 }, f.cookie)).data
      ?.created,
    20,
  )
  const last = await f.call<ImportJob>('POST', path, { offset: 20 }, f.cookie)
  assert.equal(last.data?.created, 21)
  assert.equal(last.data?.status, 'completed')
})
