import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rdbDiagnostic,
  rdbFailureCode,
} from '../apps/functions/src/members/rdb-diagnostics'
import { DatabaseFailure } from '../apps/functions/src/members/pg-store'
import { createHandler } from '../apps/functions/src/index'

test('RDB diagnostics retain HTTP status, known nested provider codes and trace IDs without raw errors', async () => {
  for (const [body, status, expected] of [
    [
      { error: { code: 'PGRST202', message: 'private data' } },
      404,
      'RDB_RPC_NOT_INSTALLED',
    ],
    [
      {
        Response: {
          Error: { Code: 'INVALID_PATH', Message: 'private data' },
          RequestId: '11111111-2222-4333-8444-555555555555',
        },
      },
      404,
      'RDB_ENDPOINT_NOT_AVAILABLE',
    ],
    [
      { code: 'PGRST106', details: 'private data' },
      406,
      'RDB_SCHEMA_NOT_EXPOSED',
    ],
    [
      { code: '42501', hint: 'private data' },
      400,
      'RDB_HTTP_PERMISSION_DENIED',
    ],
    [{ code: 'PGRST205' }, 404, 'RDB_SCHEMA_NOT_INSTALLED'],
    [{ code: 'FailedOperation' }, 500, 'RDB_HTTP_FAILED'],
    [
      {
        code: 'member-2025-secret',
        message: 'private data',
        requestId: 'session-token-secret',
      },
      500,
      'RDB_HTTP_FAILED',
    ],
  ] as const) {
    const result = await rdbDiagnostic(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
      'ec_read',
    )
    assert.equal(result.upstreamStatus, status)
    assert.equal(rdbFailureCode(result), expected)
    const serialized = JSON.stringify(result)
    assert.ok(!serialized.includes('private data'))
    assert.ok(!serialized.includes('session-token-secret'))
    assert.ok(!serialized.includes('member-2025-secret'))
    if ('Response' in body)
      assert.equal(
        result.upstreamRequestId,
        '11111111-2222-4333-8444-555555555555',
      )
  }
  const html = await rdbDiagnostic(
    new Response('<html>secret gateway page</html>', {
      status: 502,
      headers: {
        'Content-Type': 'text/html',
        'x-request-id': '11111111-2222-4333-8444-555555555555',
      },
    }),
    'ec_read',
  )
  assert.equal(html.responseKind, 'html')
  assert.equal(html.upstreamStatus, 502)
  assert.equal(html.upstreamCode, 'UNRECOGNIZED')
  assert.ok(!JSON.stringify(html).includes('secret'))
  const logs: string[] = []
  const previous = console.error
  try {
    console.error = (value) => {
      logs.push(String(value))
    }
    const handler = createHandler(() => {
      throw new DatabaseFailure('http_rpc', 'RDB_HTTP_FAILED', html)
    })
    const result = await handler({
      path: '/api/auth/me',
      httpMethod: 'GET',
      headers: { cookie: '__Host-ec-session=opaque-test' },
    })
    assert.equal(result.statusCode, 503)
    assert.ok(!result.body.includes('upstreamStatus'))
    assert.equal(JSON.parse(logs[0]!).upstreamStatus, 502)
    assert.ok(!logs[0]!.includes('opaque-test'))
  } finally {
    console.error = previous
  }
})
