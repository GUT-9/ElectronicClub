import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { mediaSuite } from './helpers/media-suite'
test('inline media: bounded chunk transport, privacy, content bindings, cleanup, and permission grouping', async () => {
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00MEDIAROOT', name: '图片测试管理员' },
    'Media-Root123',
  )
  const login = await service.login(
    { studentId: '00MEDIAROOT', password: 'Media-Root123' },
    'test',
  )
  await mediaSuite(service, store, login.token!)
})

test('media HTTP routes preserve CSRF, request limits and guest image privacy', async () => {
  const { createHandler } = await import('../apps/functions/src/index')
  const { testPng } = await import('./helpers/forum-suite')
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00MEDIAHTTP', name: '图片网关测试' },
    'Media-Http123',
  )
  const token = (
    await service.login(
      { studentId: '00MEDIAHTTP', password: 'Media-Http123' },
      'test',
    )
  ).token!
  const previousOrigin = process.env.ALLOWED_ORIGIN,
    previousSecure = process.env.COOKIE_SECURE
  process.env.ALLOWED_ORIGIN = 'https://media.test'
  process.env.COOKIE_SECURE = 'true'
  const handler = createHandler(() => service)
  const { sessionCookieConfig } =
    await import('../apps/functions/src/members/cookie')
  const headers = {
    origin: 'https://media.test',
    'content-type': 'application/json',
    'x-requested-with': 'ElectronicClub',
    cookie: sessionCookieConfig().name + '=' + token,
  }
  try {
    assert.equal(
      (
        await handler({
          path: '/api/media',
          httpMethod: 'POST',
          headers: { ...headers, origin: 'https://evil.test' },
          body: '{}',
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (
        await handler({
          path: '/api/media',
          httpMethod: 'POST',
          headers,
          body: ' '.repeat(65537),
        })
      ).statusCode,
      413,
    )
    const bytes = testPng()
    const created = await handler({
      path: '/api/media',
      httpMethod: 'POST',
      headers,
      body: JSON.stringify({ mime: 'image/png', bytes: bytes.length }),
    })
    assert.equal(created.statusCode, 200)
    const id = JSON.parse(created.body).data.id
    assert.equal(
      (
        await handler({
          path: `/api/media/${id}/chunks/0`,
          httpMethod: 'POST',
          headers,
          body: JSON.stringify({ data: bytes.toString('base64') }),
        })
      ).statusCode,
      200,
    )
    assert.equal(
      (
        await handler({
          path: `/api/media/${id}/complete`,
          httpMethod: 'POST',
          headers,
          body: '{}',
        })
      ).statusCode,
      200,
    )
    assert.equal(
      (await handler({ path: '/api/media/' + id, httpMethod: 'GET' }))
        .statusCode,
      404,
    )
    const binary = await handler({
      path: '/api/media/' + id,
      httpMethod: 'GET',
      headers,
    })
    assert.equal(binary.statusCode, 200)
    assert.equal(binary.headers['Content-Type'], 'image/png')
    assert.equal(binary.headers['X-Content-Type-Options'], 'nosniff')
    assert.deepEqual(Buffer.from(binary.body, 'base64'), bytes)
  } finally {
    if (previousOrigin === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = previousOrigin
    if (previousSecure === undefined) delete process.env.COOKIE_SECURE
    else process.env.COOKIE_SECURE = previousSecure
  }
})
