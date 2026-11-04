import { test } from 'node:test'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { accessSuite } from './helpers/access-suite'
test('role access workspace: membership deltas, effective sources, privacy and authorization', async () => {
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00ACCESSROOT', name: '测试管理员' },
    'Access-Root123',
  )
  const login = await service.login(
    { studentId: '00ACCESSROOT', password: 'Access-Root123' },
    'test',
  )
  await accessSuite(service, store, login.token!)
})
