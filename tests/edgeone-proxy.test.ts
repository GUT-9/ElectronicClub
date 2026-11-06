import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { proxyApi, DEFAULT_API_UPSTREAM } from '../deploy/edgeone/proxy'
import {
  loginContext,
  signedProxyIp,
} from '../apps/functions/src/members/login-context'
import { createHandler } from '../apps/functions/src/index'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { MemberService } from '../apps/functions/src/members/service'

const origin = 'https://club.test',
  secret = 'a'.repeat(64)
test('same-origin proxy fixes the destination, keeps query/method/body/CSRF, and excludes unrelated cookies and spoofed headers', async () => {
  let calls = 0
  const response = await proxyApi(
    {
      request: new Request(`${origin}/api/events/search?q=a%2Fb&page=2`, {
        method: 'POST',
        body: '{"title":"test"}',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-requested-with': 'ElectronicClub',
          cookie: '__Host-ec-session=testToken_123; other_site_secret=private',
          'x-forwarded-for': '203.0.113.99',
          'x-eclub-client-ip': '203.0.113.99',
          'x-eclub-proxy-signature': 'b'.repeat(64),
          authorization: 'Bearer private',
        },
      }),
    },
    async (url, options) => {
      calls++
      assert.equal(
        String(url),
        `${DEFAULT_API_UPSTREAM}/api/events/search?q=a%2Fb&page=2`,
      )
      const headers = new Headers(options!.headers)
      assert.equal(options!.method, 'POST')
      assert.equal(options!.redirect, 'manual')
      assert.equal(headers.get('origin'), origin)
      assert.equal(headers.get('x-requested-with'), 'ElectronicClub')
      assert.equal(headers.get('cookie'), '__Host-ec-session=testToken_123')
      assert.equal(typeof options!.body, 'string')
      for (const name of [
        'authorization',
        'x-forwarded-for',
        'x-eclub-client-ip',
        'x-eclub-proxy-signature',
      ])
        assert.equal(headers.get(name), null)
      assert.equal(await new Response(options!.body).text(), '{"title":"test"}')
      return new Response('{"success":false}', { status: 403 })
    },
  )
  assert.equal(calls, 1)
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store')
})

test('edge fetch receives exact UTF-8 JSON text even when incoming multibyte characters cross stream chunks', async () => {
  const json = JSON.stringify({
    studentId: '00TRANSPORT',
    password: 'Quote"Slash\\中文🙂',
    title: '活动正文与换行\n第二行',
  })
  const bytes = new TextEncoder().encode(json)
  let cursor = 0,
    forwarded: unknown
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor === bytes.length) return controller.close()
      // Three-byte slices deliberately split Chinese and emoji UTF-8 sequences.
      const end = Math.min(cursor + 3, bytes.length)
      controller.enqueue(bytes.subarray(cursor, end))
      cursor = end
    },
  })
  const response = await proxyApi(
    {
      request: new Request(origin + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    },
    async (_url, options) => {
      forwarded = options!.body
      // Deliberately do not let Node's Response constructor normalize a TypedArray:
      // the edge-runtime boundary must already receive portable JSON text.
      if (typeof forwarded !== 'string')
        return new Response('invalid body type', { status: 400 })
      assert.equal(forwarded, json)
      assert.deepEqual(JSON.parse(forwarded), JSON.parse(json))
      return new Response('{}')
    },
  )
  assert.equal(response.status, 200)
  assert.equal(typeof forwarded, 'string')
})

test('proxy rejects invalid JSON UTF-8 before forwarding and uses ArrayBuffer for non-JSON bodies', async () => {
  let calls = 0,
    binary: unknown
  const fetcher: typeof fetch = async (_url, options) => {
    calls++
    binary = options!.body
    return new Response('{}')
  }
  const invalid = await proxyApi(
    {
      request: new Request(origin + '/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]),
      }),
    },
    fetcher,
  )
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON')
  assert.equal(calls, 0)
  const response = await proxyApi(
    {
      request: new Request(origin + '/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array([0, 128, 255]),
      }),
    },
    fetcher,
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-eclub-api-revision'), 'json-text-v2')
  assert.ok(binary instanceof ArrayBuffer)
  assert.deepEqual(new Uint8Array(binary), new Uint8Array([0, 128, 255]))
})

test('proxy preserves secure session cookies, deletion, binary downloads and error status without caching or redirecting', async () => {
  for (const cookie of [
    '__Host-ec-session=test; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure',
    '__Host-ec-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
  ]) {
    const binary = new Uint8Array([0, 255, 128, 13, 10])
    const response = await proxyApi(
      { request: new Request(origin + '/api/export') },
      async () =>
        new Response(binary, {
          headers: {
            'set-cookie': cookie,
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="members.xlsx"',
          },
        }),
    )
    assert.equal(response.headers.get('set-cookie'), cookie)
    assert.match(response.headers.get('content-disposition')!, /members.xlsx/)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary)
  }
  for (const status of [401, 403, 404, 413, 429, 503]) {
    const response = await proxyApi(
      { request: new Request(origin + '/api/test') },
      async () => new Response('test', { status }),
    )
    assert.equal(response.status, status)
  }
  const redirected = await proxyApi(
    { request: new Request(origin + '/api/test') },
    async () => Response.redirect('https://other.test', 302),
  )
  assert.equal(redirected.status, 502)
  assert.equal(redirected.headers.get('location'), null)
})

test('proxy rejects loops, insecure origins, invalid routes, unsupported methods and oversized streamed bodies', async () => {
  const fetcher: typeof fetch = async () => {
    throw Error('must not fetch')
  }
  for (const upstream of [
    origin,
    'http://api.test',
    'https://api.test/api',
    'https://user:password@api.test',
    'https://api.test/?url=evil',
  ])
    assert.equal(
      (
        await proxyApi(
          {
            request: new Request(origin + '/api/health'),
            env: { API_UPSTREAM_ORIGIN: upstream },
          },
          fetcher,
        )
      ).status,
      503,
    )
  assert.equal(
    (await proxyApi({ request: new Request(origin + '/assets/test') }, fetcher))
      .status,
    404,
  )
  assert.equal(
    (
      await proxyApi(
        { request: new Request(origin + '/api/test', { method: 'PROPFIND' }) },
        fetcher,
      )
    ).status,
    405,
  )
  assert.equal(
    (
      await proxyApi(
        {
          request: new Request(origin + '/api/test', {
            method: 'POST',
            body: 'x'.repeat(3_100_001),
          }),
        },
        fetcher,
      )
    ).status,
    413,
  )
  const broken = await proxyApi(
    { request: new Request(origin + '/api/test') },
    async () => {
      throw Error('private credentials must not leak')
    },
  )
  assert.equal(broken.status, 502)
  assert.ok(!(await broken.text()).includes('credentials'))
})

test('signed EdgeOne metadata uses platform client IP and interoperates with backend HMAC; untrusted and expired signatures never override gateway IP', async () => {
  const old = process.env.ECLUB_PROXY_SECRET
  process.env.ECLUB_PROXY_SECRET = secret
  try {
    const request = new Request(origin + '/api/auth/login', {
      headers: { 'user-agent': 'Safari test', 'x-real-ip': '192.0.2.200' },
    })
    const response = await proxyApi(
      {
        request,
        eo: { clientIp: '2001:db8::1' },
        env: { ECLUB_PROXY_SECRET: secret },
      },
      async (_url, options) => {
        const headers = Object.fromEntries(new Headers(options!.headers))
        assert.equal(signedProxyIp(headers), '2001:db8::1')
        const context = loginContext({ sourceIp: '192.0.2.1' }, headers)
        assert.equal(context.ip, '2001:db8::1')
        assert.equal(context.ipSource, 'trusted-header')
        for (const tampered of [
          { ...headers, 'x-eclub-client-ip': '203.0.113.99' },
          { ...headers, 'user-agent': 'tampered' },
          { ...headers, 'x-eclub-proxy-signature': '界'.repeat(64) },
        ])
          assert.equal(
            loginContext({ sourceIp: '192.0.2.1' }, tampered).ip,
            '192.0.2.1',
          )
        assert.equal(
          signedProxyIp(
            headers,
            Number(headers['x-eclub-proxy-time']) + 60_001,
          ),
          null,
        )
        process.env.ECLUB_PROXY_SECRET = 'b'.repeat(64)
        assert.equal(signedProxyIp(headers), null)
        delete process.env.ECLUB_PROXY_SECRET
        assert.equal(signedProxyIp(headers), null)
        return new Response('{}')
      },
    )
    assert.equal(response.status, 200)
    process.env.ECLUB_PROXY_SECRET = secret
    const timestamp = String(Date.now()),
      ip = 'not-an-ip'
    const signature = createHmac('sha256', secret)
      .update(`eclub-proxy-ip-v1\n${timestamp}\n${ip}\n`)
      .digest('hex')
    assert.equal(
      signedProxyIp({
        'x-eclub-client-ip': ip,
        'x-eclub-proxy-time': timestamp,
        'x-eclub-proxy-signature': signature,
      }),
      null,
    )
  } finally {
    if (old === undefined) delete process.env.ECLUB_PROXY_SECRET
    else process.env.ECLUB_PROXY_SECRET = old
  }
})

test('same-origin login, refresh, RBAC, CSRF and logout work through the real handler; the old direct API stays usable', async () => {
  const keys = [
    'ALLOWED_ORIGIN',
    'COOKIE_SECURE',
    'COOKIE_SAMESITE',
    'ECLUB_PROXY_SECRET',
  ] as const
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    ALLOWED_ORIGIN: origin,
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'lax',
    ECLUB_PROXY_SECRET: secret,
  })
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00PROXYROOT', name: 'Isolated proxy test' },
    'Proxy-Test123',
  )
  const handler = createHandler(() => service)
  const bridge: typeof fetch = async (target, options) => {
    const url = new URL(String(target))
    const result = await handler({
      path: url.pathname,
      httpMethod: options?.method,
      headers: Object.fromEntries(new Headers(options?.headers)),
      body: options?.body ? await new Response(options.body).text() : undefined,
      queryStringParameters: Object.fromEntries(url.searchParams),
      requestContext: { sourceIp: '192.0.2.1' },
    })
    return new Response(result.body, {
      status: result.statusCode,
      headers: result.headers,
    })
  }
  let cookie = ''
  const call = async (path: string, data?: unknown, source = origin) =>
    proxyApi(
      {
        request: new Request(origin + '/api' + path, {
          method: data === undefined ? 'GET' : 'POST',
          headers: {
            origin: source,
            'content-type': 'application/json',
            'x-requested-with': 'ElectronicClub',
            'user-agent': 'Safari test',
            ...(cookie ? { cookie } : {}),
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        }),
        env: { ECLUB_PROXY_SECRET: secret },
        eo: { clientIp: '203.0.113.5' },
      },
      bridge,
    )
  try {
    const login = await call('/auth/login', {
      studentId: '00PROXYROOT',
      password: 'Proxy-Test123',
    })
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax/)
    cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const me = await call('/auth/me')
    assert.equal(me.status, 200)
    assert.equal((await me.json()).data.super, true)
    assert.equal((await call('/roles')).status, 200)
    const history = await call('/login-history')
    assert.equal(history.status, 200)
    assert.match(await history.text(), /203\.0\.113\.5/)
    assert.equal(
      (await call('/auth/logout', {}, 'https://evil.test')).status,
      403,
    )
    const logout = await call('/auth/logout', {})
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get('set-cookie')!, /Max-Age=0; Secure/)
    assert.equal((await call('/auth/me')).status, 401)
    const legacy = await handler({
      path: '/api/auth/login',
      httpMethod: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-requested-with': 'ElectronicClub',
      },
      requestContext: { sourceIp: '203.0.113.6' },
      body: JSON.stringify({
        studentId: '00PROXYROOT',
        password: 'Proxy-Test123',
      }),
    })
    assert.equal(legacy.statusCode, 200)
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key]
      else process.env[key] = old[key]
    }
  }
})
