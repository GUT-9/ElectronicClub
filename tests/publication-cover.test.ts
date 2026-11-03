/// <reference types="vite/client" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { savePublication } from '../apps/web/src/publication-api'
import type { request } from '../apps/web/src/member-api'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import type { ClubEvent } from '../packages/shared/src/index'

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
})

test('save verifies persisted cover and surfaces discarded images or failed readback', async () => {
  for (const failure of ['missing-cover', 'read-error']) {
    const calls: string[] = []
    let submitted = ''
    const send: typeof request = async <T>(path: string, method = 'GET') => {
      calls.push(method + ' ' + path)
      if (method === 'PATCH') return { id: 'test-id', cover } as T
      if (failure === 'read-error') throw new Error('服务暂不可用')
      return { id: 'test-id', cover: '' } as T
    }
    await assert.rejects(savePublication('events', 'test-id', { cover }, send, (saved) => {
      submitted = saved.id
    }), /封面保存未确认/)
    assert.equal(submitted, 'test-id')
    assert.deepEqual(calls, ['PATCH /events/test-id', 'GET /events/test-id'])
  }
})
