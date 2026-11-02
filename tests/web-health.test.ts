/// <reference types="vite/client" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestHealth, HealthCheckError } from '../apps/web/src/api'
test('web diagnostics distinguish gateway errors, HTML fallback, invalid payload and network errors', async () => {
  const endpoint = 'https://api.example.test/api/health'
  for (const [response, expected] of [
    [new Response('', { status: 404 }), /HTTP 404/],
    [
      new Response('<html>SPA</html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
      /返回了网页/,
    ],
    [new Response('not-json'), /有效 JSON/],
    [new Response('{"success":true,"data":{}}'), /格式不匹配/],
  ] as const) {
    await assert.rejects(
      requestHealth(endpoint, async () => response),
      (error) =>
        error instanceof HealthCheckError &&
        error.endpoint === endpoint &&
        expected.test(error.message),
    )
  }
  await assert.rejects(
    requestHealth(endpoint, async () => {
      throw new TypeError('Failed to fetch')
    }),
    (error) => error instanceof HealthCheckError && /跨域/.test(error.message),
  )
  const body = {
    success: true,
    data: {
      status: 'ok',
      service: 'ElectronicClub API',
      timestamp: new Date().toISOString(),
    },
  }
  assert.deepEqual(
    await requestHealth(
      endpoint,
      async () => new Response(JSON.stringify(body)),
    ),
    body,
  )
})
