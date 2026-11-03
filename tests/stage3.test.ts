import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { stage3Suite } from './helpers/stage3-suite'
import { createHandler } from '../apps/functions/src/index'
import { dismissPopup, dismissedPopup } from '../apps/web/src/stage3'
test('stage3 business: registration concurrency, scoped RBAC, audit, export, checkin and popup switching', async () => {
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00rootstage', name: 'Test' },
    'Stage3Root123',
  )
  const token = (
    await service.login(
      { studentId: '00rootstage', password: 'Stage3Root123' },
      'test',
    )
  ).token!
  await stage3Suite(service, store, token)
  const handler = createHandler(() => service)
  assert.equal(
    (await handler({ path: '/api/events', httpMethod: 'GET' })).statusCode,
    401,
  )
  assert.equal(
    (await handler({ path: '/api/public/events', httpMethod: 'GET' }))
      .statusCode,
    200,
  )
})
test('popup dismissal is session-version scoped', () => {
  const old = globalThis.sessionStorage,
    items = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => items.set(k, v),
    },
  })
  try {
    assert.equal(dismissedPopup('v1'), false)
    dismissPopup('v1')
    assert.equal(dismissedPopup('v1'), true)
    assert.equal(dismissedPopup('v2'), false)
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: old,
    })
  }
})
