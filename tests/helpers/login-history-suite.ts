import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  Member,
  Role,
  Page,
  LoginRecord,
  AuditLog,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
import { loginContext } from '../../apps/functions/src/members/login-context'
export async function loginHistorySuite(
  service: MemberService,
  store: Store,
  root: string,
) {
  const call = (
    token: string,
    method: string,
    path: string,
    body: unknown = {},
    query: Record<string, string> = {},
  ) => service.execute(token, method, '/api' + path, body, query)
  const member = (
    await call(root, 'POST', '/members', {
      studentId: '00LOGIN01',
      name: '登录历史测试',
    })
  ).data as Member
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.1.0'
  const context = loginContext(
    { sourceIp: '203.0.113.17' },
    { 'user-agent': ua, 'x-forwarded-for': '192.0.2.66' },
  )
  const first = await service.login(
    { studentId: member.studentId, password: '123456' },
    context,
  )
  await call(first.token!, 'POST', '/auth/password', {
    oldPassword: '123456',
    newPassword: 'Login-Case123',
  })
  let token = (
    await service.login(
      { studentId: member.studentId, password: 'Login-Case123' },
      context,
    )
  ).token!
  const wrong = await service.login(
    { studentId: member.studentId, password: 'Incorrect-123' },
    context,
  )
  assert.equal(wrong.status, 401)
  await service.login(
    { studentId: '00UNKNOWN01', password: 'Incorrect-123' },
    context,
  )
  const legacyId = randomUUID()
  await store.run((tx) =>
    tx.set('audit_logs', legacyId, {
      id: legacyId,
      actor: member.uid,
      target: member.uid,
      action: 'auth.login',
      fields: [],
      createdAt: '2020-01-01T00:00:00.000Z',
    }),
  )
  let rows = (
    await call(
      root,
      'GET',
      '/login-history',
      {},
      { search: member.studentId, pageSize: '50' },
    )
  ).data as Page<LoginRecord>
  assert.ok(rows.total >= 4)
  assert.ok(
    rows.items.every(
      (r) => r.name === member.name && r.studentId === member.studentId,
    ),
  )
  assert.ok(rows.items.some((r) => r.outcome === 'failure'))
  const record = rows.items.find((r) => r.outcome === 'success' && !r.legacy)!
  assert.equal(record.ip, '203.0.113.17')
  assert.equal(record.ipSource, 'gateway')
  assert.equal(record.device, '电脑')
  assert.equal(record.browser, 'Edge 140.0.1.0')
  assert.equal(record.os, 'Windows 10/11')
  assert.equal(record.userAgent, ua)
  const legacy = rows.items.find((r) => r.id === legacyId)!
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.ip, null)
  const onlySuccess = (
    await call(
      root,
      'GET',
      '/login-history',
      {},
      { search: member.studentId, outcome: 'success', pageSize: '1' },
    )
  ).data as Page<LoginRecord>
  assert.equal(onlySuccess.items.length, 1)
  assert.ok(onlySuccess.total > 1)
  const datePage = (
    await call(
      root,
      'GET',
      '/login-history',
      {},
      {
        search: member.studentId,
        from: '2019-12-31T16:00:00Z',
        to: '2020-01-01T16:00:00Z',
      },
    )
  ).data as Page<LoginRecord>
  assert.deepEqual(
    datePage.items.map((r) => r.id),
    [legacyId],
  )
  const malicious = (
    await call(
      root,
      'GET',
      '/login-history',
      {},
      { search: "';DROP TABLE electronicclub.users;--" },
    )
  ).data as Page<LoginRecord>
  assert.equal(malicious.total, 0)
  const general = (await call(root, 'GET', '/audit')).data as Page<AuditLog>
  assert.ok(!JSON.stringify(general).includes(ua))
  assert.ok(!JSON.stringify(general).includes('203.0.113.17'))
  assert.ok(general.items.every((r) => !('login' in r)))
  await assert.rejects(() => call('', 'GET', '/login-history'), /登录|会话/)
  await assert.rejects(() => call(token, 'GET', '/login-history'), /权限/)
  const role = (
    await call(root, 'POST', '/roles', {
      name: '仅操作审计',
      description: '无权查看网络设备信息',
      permissionIds: ['audit.read'],
    })
  ).data as Role
  await call(root, 'PUT', `/members/${member.uid}/roles`, {
    roleIds: [role.id],
  })
  token = (
    await service.login(
      { studentId: member.studentId, password: 'Login-Case123' },
      context,
    )
  ).token!
  await call(token, 'GET', '/audit')
  await assert.rejects(() => call(token, 'GET', '/login-history'), /权限/)
  await call(root, 'PUT', `/roles/${role.id}`, {
    name: role.name,
    description: role.description,
    permissionIds: ['audit.read', 'security.logins.read'],
  })
  await call(token, 'GET', '/login-history')
  await call(root, 'PUT', `/roles/${role.id}`, {
    name: role.name,
    description: role.description,
    permissionIds: ['audit.read'],
  })
  await assert.rejects(() => call(token, 'GET', '/login-history'), /权限/)
  await assert.rejects(() =>
    call(root, 'GET', '/login-history', {}, { pageSize: '1000' }),
  )
  await assert.rejects(
    () =>
      call(
        root,
        'GET',
        '/login-history',
        {},
        { from: '2030-01-02T00:00:00Z', to: '2030-01-01T00:00:00Z' },
      ),
    /日期/,
  )
  // Blocked requests are audited once per exhausted limiter, preventing log amplification.
  for (let n = 0; n < 12; n++)
    await service.login(
      { studentId: '00BLOCKED01', password: 'Invalid-123' },
      context,
    )
  const blocked = (
    await call(
      root,
      'GET',
      '/login-history',
      {},
      { outcome: 'blocked', search: '203.0.113.17' },
    )
  ).data as Page<LoginRecord>
  assert.equal(
    blocked.items.filter((r) => r.reason === 'RATE_LIMITED').length,
    1,
  )
  await call(root, 'DELETE', `/members/${member.uid}`)
  await call(root, 'POST', `/members/${member.uid}/anonymize`)
  rows = (
    await call(
      root,
      'GET',
      '/login-history',
      {},
      { search: '已匿名化', pageSize: '50' },
    )
  ).data as Page<LoginRecord>
  assert.ok(rows.items.length > 0)
  assert.ok(
    rows.items.every(
      (r) => !r.ip && !r.userAgent && !r.studentId && r.anonymized,
    ),
  )
  const raw = await store.read<AuditLog & { login?: unknown }>(
    'audit_logs',
    record.id,
  )
  assert.ok(
    raw && !raw.login,
    'anonymization must erase stored IP and UA, not just hide them in the UI',
  )
  return { legacyId }
}
