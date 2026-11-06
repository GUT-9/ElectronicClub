import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginContext } from '../apps/functions/src/members/login-context'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { MemberService } from '../apps/functions/src/members/service'
import { loginHistorySuite } from './helpers/login-history-suite'
test('login metadata trusts gateway context, bounds raw UA and detects browsers without new dependencies', () => {
  const old = process.env.LOGIN_TRUSTED_IP_HEADER
  delete process.env.LOGIN_TRUSTED_IP_HEADER
  try {
    assert.equal(
      loginContext(undefined, { 'x-forwarded-for': '203.0.113.7' }).ip,
      null,
    )
    assert.equal(
      loginContext({ sourceIp: 'bad' }, { 'x-real-ip': '203.0.113.7' }).ip,
      null,
    )
    assert.equal(
      loginContext({ http: { sourceIp: '2001:db8::1' } }, {}).ip,
      '2001:db8::1',
    )
    process.env.LOGIN_TRUSTED_IP_HEADER = 'x-forwarded-for'
    const trusted = loginContext(undefined, {
      'x-forwarded-for': '203.0.113.8, 192.0.2.1',
    })
    assert.equal(trusted.ip, '203.0.113.8')
    assert.equal(trusted.ipSource, 'trusted-header')
    assert.equal(
      loginContext(
        { sourceIp: '203.0.113.9' },
        { 'x-forwarded-for': '192.0.2.2' },
      ).ip,
      '203.0.113.9',
    )
    const ios = loginContext(undefined, {
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605 Version/18.1 Mobile/15 Safari/604.1',
    })
    assert.equal(ios.device, '手机')
    assert.equal(ios.os, 'iOS 18.1')
    assert.equal(ios.browser, 'Safari 18.1')
    assert.equal(
      loginContext(undefined, {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36',
      }).device,
      '手机',
    )
    const raw = loginContext(undefined, {
      'user-agent': '<script>unsafe</script>\r\n' + 'a'.repeat(1000),
    })
    assert.ok(raw.userAgent.length <= 512)
    assert.ok(!raw.userAgent.includes('\n'))
  } finally {
    if (old === undefined) delete process.env.LOGIN_TRUSTED_IP_HEADER
    else process.env.LOGIN_TRUSTED_IP_HEADER = old
  }
})
test('login history: identity joins, privacy boundaries, indexed paging/filtering, legacy rows, limiter and anonymization', async () => {
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00LOGINROOT', name: '登录审计管理员' },
    'Login-Root123',
  )
  const token = (
    await service.login(
      { studentId: '00LOGINROOT', password: 'Login-Root123' },
      '127.0.0.1',
    )
  ).token!
  await loginHistorySuite(service, store, token)
})

test('HTTP login captures platform source IP and User-Agent; login-history requires its own permission', async () => {
  const { createHandler } = await import('../apps/functions/src/index')
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00LOGINHTTP', name: '网关登录测试' },
    'Gateway-Login123',
  )
  const oldOrigin = process.env.ALLOWED_ORIGIN,
    oldSecure = process.env.COOKIE_SECURE,
    oldTrusted = process.env.LOGIN_TRUSTED_IP_HEADER
  process.env.ALLOWED_ORIGIN = 'https://login.test'
  process.env.COOKIE_SECURE = 'true'
  delete process.env.LOGIN_TRUSTED_IP_HEADER
  try {
    const handler = createHandler(() => service)
    const headers = {
      origin: 'https://login.test',
      'content-type': 'application/json',
      'x-requested-with': 'ElectronicClub',
      'user-agent':
        'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36',
      'x-forwarded-for': '198.51.100.99',
    }
    const login = await handler({
      path: '/api/auth/login',
      httpMethod: 'POST',
      headers,
      body: JSON.stringify({
        studentId: '00LOGINHTTP',
        password: 'Gateway-Login123',
      }),
      requestContext: { identity: { sourceIp: '2001:db8::7' } },
    })
    assert.equal(login.statusCode, 200)
    const cookie = login.headers['Set-Cookie'].split(';')[0]
    const history = await handler({
      path: '/api/login-history',
      httpMethod: 'GET',
      headers: { ...headers, cookie },
      queryStringParameters: { search: '00LOGINHTTP' },
    })
    assert.equal(history.statusCode, 200)
    const row = JSON.parse(history.body).data.items[0]
    assert.equal(row.name, '网关登录测试')
    assert.equal(row.ip, '2001:db8::7')
    assert.equal(row.device, '手机')
    assert.equal(row.browser, 'Chrome 140.0')
    assert.ok(!history.body.includes('Gateway-Login123'))
    assert.ok(!history.body.includes(cookie))
    assert.equal(
      (await handler({ path: '/api/login-history', httpMethod: 'GET' }))
        .statusCode,
      401,
    )
  } finally {
    if (oldOrigin === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = oldOrigin
    if (oldSecure === undefined) delete process.env.COOKIE_SECURE
    else process.env.COOKIE_SECURE = oldSecure
    if (oldTrusted === undefined) delete process.env.LOGIN_TRUSTED_IP_HEADER
    else process.env.LOGIN_TRUSTED_IP_HEADER = oldTrusted
  }
})
