import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { memberPurgeSuite } from './helpers/member-purge-suite'
import { ApiError } from '../apps/functions/src/members/model'
import { createHandler } from '../apps/functions/src/index'
import { sessionCookieConfig } from '../apps/functions/src/members/cookie'

test('member purge: independent RBAC, cleanup, reuse, business guards, rollback and concurrency', async () => {
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00PURGEROOT', name: '删除测试管理员' },
    'Purge-Root123',
  )
  const root = (
    await service.login(
      { studentId: '00PURGEROOT', password: 'Purge-Root123' },
      'purge-test',
    )
  ).token!
  await store.run((tx) =>
    tx.set('system', 'member_purge', { version: '014-member-purge' }),
  )
  await memberPurgeSuite(service, store, root)
})

test('purge requires the database capability; HTTP endpoint keeps auth/CSRF and returns actionable conflicts', async () => {
  const store = new MemoryStore(),
    service = new MemberService(store)
  const rootMember = await service.bootstrap(
    { studentId: '00PURGEHTTP', name: '接口测试管理员' },
    'Purge-Http123',
  )
  const root = (
    await service.login(
      { studentId: rootMember.studentId, password: 'Purge-Http123' },
      'purge-test',
    )
  ).token!
  const member = (
    await service.execute(
      root,
      'POST',
      '/api/members',
      { studentId: '00PURGENODB', name: '无迁移' },
      {},
    )
  ).data as { uid: string }
  await service.execute(root, 'DELETE', '/api/members/' + member.uid, {}, {})
  await assert.rejects(
    () =>
      service.execute(
        root,
        'POST',
        `/api/members/${member.uid}/purge`,
        { confirmUid: member.uid },
        {},
      ),
    (e: unknown) =>
      e instanceof ApiError && e.code === 'PURGE_MIGRATION_REQUIRED',
  )
  const oldOrigin = process.env.ALLOWED_ORIGIN
  process.env.ALLOWED_ORIGIN = 'https://purge.example.test'
  try {
    const handler = createHandler(() => service)
    const event = {
      httpMethod: 'POST',
      path: `/api/members/${member.uid}/purge`,
      headers: {
        origin: 'https://purge.example.test',
        'content-type': 'application/json',
        'x-requested-with': 'ElectronicClub',
        cookie: `${sessionCookieConfig().name}=${root}`,
      },
      body: JSON.stringify({ confirmUid: member.uid }),
    }
    assert.equal(
      (await handler({ ...event, headers: { ...event.headers, cookie: '' } }))
        .statusCode,
      401,
    )
    assert.equal(
      (
        await handler({
          ...event,
          headers: { ...event.headers, origin: 'https://evil.example.test' },
        })
      ).statusCode,
      403,
    )
    const missing = await handler(event)
    assert.equal(missing.statusCode, 503)
    assert.match(missing.body, /PURGE_MIGRATION_REQUIRED/)
    await store.run((tx) =>
      tx.set('system', 'member_purge', { version: '014-member-purge' }),
    )
    assert.equal((await handler(event)).statusCode, 200)
  } finally {
    if (oldOrigin === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = oldOrigin
  }
})
