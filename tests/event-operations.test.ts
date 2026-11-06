import { test } from 'node:test'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { eventOperationsSuite } from './helpers/event-operations-suite'
test('event operations: role-based multi-manager assignment persists, review-only access, paged roster and configurable check-in lifecycle', async () => {
  let now = Date.now()
  const store = new MemoryStore(),
    service = new MemberService(store, () => now)
  await service.bootstrap(
    { studentId: '00OPSROOT', name: '活动流程管理员' },
    'Event-OpsRoot123',
  )
  const root = (
    await service.login(
      { studentId: '00OPSROOT', password: 'Event-OpsRoot123' },
      'ops-test',
    )
  ).token!
  await eventOperationsSuite(
    service,
    store,
    root,
    (ms) => (now += ms),
    () => now,
  )
})
