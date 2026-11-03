/// <reference types="vite/client" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { savePublication } from '../apps/web/src/publication-api'
import type { request } from '../apps/web/src/member-api'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import type { ClubEvent } from '../packages/shared/src/index'
import { createHandler } from '../apps/functions/src/index'
import { sessionCookieConfig } from '../apps/functions/src/members/cookie'

const cover = 'data:image/jpeg;base64,/9j/2Q=='
test('editing a published event persists JPG cover to admin and public reads', async () => {
  const service = new MemberService(new MemoryStore())
  await service.bootstrap({ studentId: '00COVERTEST', name: 'Local test' }, 'LocalTest123')
  const { token } = await service.login({ studentId: '00COVERTEST', password: 'LocalTest123' }, 'local')
  const call = (method: string, path: string, data: unknown = {}) => service.execute(token!, method, path, data, {})
  const event = (await call('POST', '/api/events', {
    title: 'Cover regression test',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 172800000).toISOString(),
    status: 'published',
  })).data as ClubEvent
  const send: typeof request = async <T>(path: string, method = 'GET', data?: unknown) => (await call(method, '/api' + path, data)).data as T
  await savePublication('events', event.id, { cover }, send)
  for (const path of ['/api/events/' + event.id, '/api/public/events/' + event.id])
    assert.equal(((await call('GET', path)).data as ClubEvent).cover, cover)
  const list = (await call('GET', '/api/public/events')).data as { items: ClubEvent[] }
  assert.equal(list.items[0]!.cover, cover)
  // Existing PATCH clients remain supported as well as POST gateway clients.
  await call('PATCH', '/api/events/' + event.id, { cover: '' })
  assert.equal(((await call('GET', '/api/events/' + event.id)).data as ClubEvent).cover, '')
  const previousOrigin = process.env.ALLOWED_ORIGIN
  process.env.ALLOWED_ORIGIN = 'https://cover-test.example'
  try {
    const handler = createHandler(() => service)
    const httpEvent = {
      path: '/api/events/' + event.id + '/update',
      httpMethod: 'POST',
      isBase64Encoded: true,
      headers: {
        origin: 'https://cover-test.example',
        'content-type': 'application/json',
        'x-requested-with': 'ElectronicClub',
        cookie: `${sessionCookieConfig().name}=${token}`,
      },
      body: Buffer.from(JSON.stringify({ cover })).toString('base64'),
    }
    const response = await handler(httpEvent)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(JSON.parse(response.body).data.cover, cover)
    assert.equal(JSON.parse(response.body).data.id, event.id)
    assert.equal((await handler({ ...httpEvent, headers: { ...httpEvent.headers, cookie: '' } })).statusCode, 401)
    assert.equal((await handler({ ...httpEvent, headers: { ...httpEvent.headers, origin: 'https://other.example' } })).statusCode, 403)
    assert.equal((await call('GET', '/api/public/events')).data && ((await call('GET', '/api/public/events')).data as { items: ClubEvent[] }).items.length, 1)
  } finally {
    if (previousOrigin === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = previousOrigin
  }
})

test('save verifies persisted cover and surfaces discarded images or failed readback', async () => {
  for (const failure of ['missing-cover', 'read-error']) {
    const calls: string[] = []
    let submitted = ''
    const send: typeof request = async <T>(path: string, method = 'GET') => {
      calls.push(method + ' ' + path)
      if (method === 'POST') return { id: 'test-id', cover } as T
      if (failure === 'read-error') throw new Error('服务暂不可用')
      return { id: 'test-id', cover: '' } as T
    }
    await assert.rejects(savePublication('events', 'test-id', { cover }, send, (saved) => {
      submitted = saved.id
    }), /封面保存未确认/)
    assert.equal(submitted, 'test-id')
    assert.deepEqual(calls, ['POST /events/test-id/update', 'GET /events/test-id'])
  }
})

test('an edit cannot silently switch to a different record returned by the server', async () => {
  let selected = 'original-id'
  const send: typeof request = async <T>() => ({ id: 'another-id', cover }) as T
  await assert.rejects(savePublication('events', selected, { cover }, send, (saved) => {
    selected = saved.id
  }), /不同的记录ID/)
  assert.equal(selected, 'original-id')
})
