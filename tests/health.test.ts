import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../apps/functions/src/index'
import { HEALTH_PATH } from '../packages/shared/src/index'
test('健康接口返回共享协议与有效时间', async () => {
  const result = await main({ path: HEALTH_PATH, httpMethod: 'GET' })
  assert.equal(result.statusCode, 200)
  const body = JSON.parse(result.body)
  assert.equal(body.success, true)
  assert.equal(body.data.status, 'ok')
  assert.equal(body.data.service, 'ElectronicClub API')
  assert.ok(Number.isFinite(Date.parse(body.data.timestamp)))
})
test('未知路径和不支持的方法分别返回 404/405', async () => {
  assert.equal(
    (await main({ path: '/missing', httpMethod: 'GET' })).statusCode,
    404,
  )
  assert.equal(
    (await main({ path: HEALTH_PATH, httpMethod: 'POST' })).statusCode,
    405,
  )
})
test('CORS 仅允许配置的站点，支持预检', async () => {
  const previous = process.env.ALLOWED_ORIGIN
  process.env.ALLOWED_ORIGIN = 'https://club.example.com'
  try {
    const result = await main({
      path: HEALTH_PATH,
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://club.example.com' },
    })
    assert.equal(result.statusCode, 204)
    assert.equal(
      result.headers['Access-Control-Allow-Origin'],
      'https://club.example.com',
    )
    const denied = await main({
      path: HEALTH_PATH,
      httpMethod: 'GET',
      headers: { origin: 'https://other.example.com' },
    })
    assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined)
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = previous
  }
})
