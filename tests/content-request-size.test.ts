/// <reference types="vite/client" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request, RequestError } from '../apps/web/src/member-api'
import { fitCover, inlineImageBytes, MAX_INLINE_IMAGE_BYTES } from '../apps/web/src/cover'

test('inline image size includes Base64 padding; small images and HTTPS URLs are preserved', async () => {
  assert.equal(inlineImageBytes('data:image/jpeg;base64,AA=='), 1)
  assert.equal(inlineImageBytes('data:image/png;base64,AAA='), 2)
  assert.equal(inlineImageBytes('data:image/webp;base64,AAAA'), 3)
  assert.equal(inlineImageBytes('https://example.test/cover.jpg'), null)
  assert.equal(await fitCover('https://example.test/cover.jpg'), 'https://example.test/cover.jpg')
  const small = 'data:image/jpeg;base64,' + Buffer.alloc(MAX_INLINE_IMAGE_BYTES).toString('base64')
  assert.equal(inlineImageBytes(small), MAX_INLINE_IMAGE_BYTES)
  assert.equal(await fitCover(small), small)
})

test('UTF-8 publication payloads are rejected before network I/O; member imports retain their own limits', async () => {
  const oldFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(JSON.stringify({ success: true, data: { ok: true } }))
  }
  try {
    for (const path of ['/events/id/update', '/events', '/articles/id/update', '/popups']) {
      await assert.rejects(request(path, 'POST', { content: '中文'.repeat(12000) }),
        (e: unknown) => e instanceof RequestError && e.code === 'PAYLOAD_TOO_LARGE' && e.status === 413)
    }
    assert.equal(calls, 0)
    await request('/events/id/update', 'POST', { content: 'Small content' })
    await request('/imports/preview', 'POST', { file: 'A'.repeat(100000) })
    assert.equal(calls, 2)
  } finally { globalThis.fetch = oldFetch }
})

test('gateway HTML 413 reports a useful size error instead of a JSON parsing error', async () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('<html>Payload Too Large</html>', { status: 413 })
  try {
    await assert.rejects(request('/events/id/update', 'POST', { cover: '' }),
      (e: unknown) => e instanceof RequestError && e.status === 413 && /过大/.test(e.message))
  } finally { globalThis.fetch = oldFetch }
})
