import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HttpBodyError,
  parseHttpBody,
  BACKEND_BODY_REVISION,
} from '../apps/functions/src/http-body'
import { createHandler, type HttpEvent } from '../apps/functions/src/index'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'

test('gateway boolean and string Base64 flags have literal meaning; false never decodes JSON', () => {
  const input = { studentId: '00BODY', password: 'Exact"\\中文🙂' },
    text = JSON.stringify(input)
  for (const flag of [undefined, null, false, 'false', 'FALSE', ' false ', ''])
    assert.deepEqual(
      parseHttpBody({ body: text, isBase64Encoded: flag }),
      input,
    )
  for (const flag of [true, 'true', 'TRUE', ' true ']) {
    assert.deepEqual(
      parseHttpBody({
        body: Buffer.from(text).toString('base64'),
        isBase64Encoded: flag,
      }),
      input,
    )
    assert.deepEqual(
      parseHttpBody({
        body: Buffer.from(text).toString('base64url'),
        isBase64Encoded: flag,
      }),
      input,
    )
  }
  assert.throws(
    () => parseHttpBody({ body: text, isBase64Encoded: 'not-a-flag' }),
    (e: unknown) =>
      e instanceof HttpBodyError &&
      e.code === 'INVALID_BODY_ENCODING' &&
      e.diagnostic.stage === 'flag',
  )
})

test('gateway text, UTF-8 BOM, byte views and already parsed JSON keep the same business input', () => {
  const input = { title: '正文🙂', nested: { values: [1, false, null] } },
    text = JSON.stringify(input)
  const bytes = Buffer.from(text),
    padded = Buffer.concat([
      Buffer.from('private-prefix'),
      bytes,
      Buffer.from('private-suffix'),
    ])
  const offset = Buffer.byteLength('private-prefix')
  const view = new DataView(
    padded.buffer,
    padded.byteOffset + offset,
    bytes.length,
  )
  for (const body of [
    text,
    '\uFEFF' + text,
    bytes,
    new Uint8Array(bytes),
    new Uint8Array(bytes).buffer,
    view,
    input,
  ])
    assert.deepEqual(parseHttpBody({ body, isBase64Encoded: false }), input)
  assert.deepEqual(parseHttpBody({}), {})
  assert.deepEqual(parseHttpBody({ body: '', isBase64Encoded: 'false' }), {})
  assert.deepEqual(parseHttpBody({ body: '[1,2]' }), [1, 2])
})

test('wire and decoded byte limits still apply to Unicode, Base64 and parsed gateway bodies', () => {
  const input = { title: '中文'.repeat(10) },
    text = JSON.stringify(input)
  for (const event of [
    { body: text },
    { body: input },
    { body: Buffer.from(text).toString('base64'), isBase64Encoded: true },
  ])
    assert.throws(
      () => parseHttpBody(event, 32),
      (e: unknown) =>
        e instanceof HttpBodyError &&
        e.status === 413 &&
        e.code === 'BODY_TOO_LARGE',
    )
  for (const body of ['!not_base64!', 'A', 'Zh=='])
    assert.throws(
      () => parseHttpBody({ body, isBase64Encoded: true }),
      (e: unknown) =>
        e instanceof HttpBodyError && e.diagnostic.stage === 'base64',
    )
  assert.throws(
    () => parseHttpBody({ body: new Uint8Array([0xff]) }),
    (e: unknown) => e instanceof HttpBodyError && e.diagnostic.stage === 'utf8',
  )
  assert.throws(
    () => parseHttpBody({ body: new Date() }),
    (e: unknown) => e instanceof HttpBodyError && e.diagnostic.stage === 'type',
  )
})

test('invalid JSON diagnostics expose only format metadata, never body, credentials, cookies or arbitrary flag values', async () => {
  const previousOrigin = process.env.ALLOWED_ORIGIN,
    previousLog = console.error
  process.env.ALLOWED_ORIGIN = 'https://body.test'
  const logs: string[] = []
  console.error = (value: unknown) => logs.push(String(value))
  let serviceCalls = 0
  const handler = createHandler(() => {
    serviceCalls++
    throw Error('Database must not be resolved')
  })
  const sensitive = 'DO-NOT-LOG-PASSWORD-OR-COOKIE'
  try {
    for (const [body, flag] of [
      [`{"password":"${sensitive}" BROKEN`, false],
      ['\0\0\0', 'false'],
      ['{}', sensitive],
    ] as const) {
      const response = await handler({
        path: '/api/auth/login',
        httpMethod: 'POST',
        body,
        isBase64Encoded: flag,
        headers: {
          origin: 'https://body.test',
          'content-type': 'application/json',
          'x-requested-with': 'ElectronicClub',
          cookie: sensitive,
        },
      })
      assert.equal(response.statusCode, 400)
      assert.equal(
        response.headers['X-EClub-Backend-Revision'],
        BACKEND_BODY_REVISION,
      )
      assert.ok(response.headers['X-EClub-Body-Error'])
      assert.ok(!response.body.includes(sensitive))
    }
    assert.equal(serviceCalls, 0)
    assert.equal(logs.length, 3)
    for (const line of logs) {
      assert.ok(!line.includes(sensitive))
      const entry = JSON.parse(line)
      assert.equal(entry.category, 'transport')
      assert.equal(entry.revision, BACKEND_BODY_REVISION)
      assert.equal(entry.body, undefined)
    }
    assert.equal(JSON.parse(logs[1]!).decodedShape, 'nul-bytes')
    assert.equal(JSON.parse(logs[2]!).flagValue, 'invalid')
  } finally {
    console.error = previousLog
    if (previousOrigin === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = previousOrigin
  }
})

test('actual login/session/RBAC/logout succeed with string false and true gateway flags, while CSRF remains enforced', async () => {
  const keys = ['ALLOWED_ORIGIN', 'COOKIE_SECURE', 'COOKIE_SAMESITE'] as const
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  )
  Object.assign(process.env, {
    ALLOWED_ORIGIN: 'https://body.test',
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'lax',
  })
  const service = new MemberService(new MemoryStore())
  await service.bootstrap(
    { studentId: '00GATEWAYBODY', name: 'Isolated transport test' },
    'Gateway-Test123',
  )
  const handler = createHandler(() => service)
  const base: HttpEvent = {
    path: '/api/auth/login',
    httpMethod: 'POST',
    headers: {
      origin: 'https://body.test',
      'content-type': 'application/json',
      'x-requested-with': 'ElectronicClub',
    },
  }
  try {
    for (const flag of ['false', 'true']) {
      const json = JSON.stringify({
        studentId: '00GATEWAYBODY',
        password: 'Gateway-Test123',
      })
      const login = await handler({
        ...base,
        body: flag === 'true' ? Buffer.from(json).toString('base64') : json,
        isBase64Encoded: flag,
      })
      assert.equal(login.statusCode, 200)
      const cookie = login.headers['Set-Cookie']!.split(';')[0]!
      const headers = { ...base.headers, cookie }
      const me = await handler({
        path: '/api/auth/me',
        httpMethod: 'GET',
        headers,
        isBase64Encoded: 'false',
      })
      assert.equal(me.statusCode, 200)
      assert.equal(JSON.parse(me.body).data.super, true)
      assert.equal(
        (
          await handler({
            ...base,
            path: '/api/roles',
            httpMethod: 'GET',
            headers,
          })
        ).statusCode,
        200,
      )
      assert.equal(
        (
          await handler({
            ...base,
            path: '/api/auth/logout',
            body: '{}',
            isBase64Encoded: 'false',
            headers: { ...headers, origin: 'https://evil.test' },
          })
        ).statusCode,
        403,
      )
      assert.equal(
        (
          await handler({
            ...base,
            path: '/api/auth/logout',
            body: '{}',
            headers,
            isBase64Encoded: 'false',
          })
        ).statusCode,
        200,
      )
      assert.equal(
        (await handler({ path: '/api/auth/me', httpMethod: 'GET', headers }))
          .statusCode,
        401,
      )
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})
