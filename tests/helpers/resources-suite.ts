import assert from 'node:assert/strict'
import type {
  Member,
  MemberStats,
  Page,
  ClubResource,
  Role,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
import type { ResourceProvider } from '../../apps/functions/src/resources/qiniu'
import type { ResourceRecord } from '../../apps/functions/src/resources/model'
import { cleanupResources } from '../../apps/functions/src/resources/service'
export class TestResourceProvider implements ResourceProvider {
  removed: string[] = []
  verified: string[] = []
  fail = false
  budget = 2048
  status() {
    return {
      configured: true,
      bucket: 'test-resources',
      domain: 'https://files.example.test',
      maxBytes: 2048,
      budget: this.budget,
    }
  }
  ticket(r: ResourceRecord, now: number) {
    return {
      uploadUrl: 'https://upload.qiniup.com',
      token: 'test-upload-token',
      key: r.key,
      expiresAt: new Date(now + 600000).toISOString(),
    }
  }
  async verify(r: ResourceRecord) {
    if (this.fail) throw new Error('Provider temporarily unavailable')
    this.verified.push(r.id)
    return { hash: 'TestQiniuHash0123456789abcdef' }
  }
  async remove(r: ResourceRecord) {
    assert.ok(r.key.startsWith('electronicclub/resources/v1/'))
    this.removed.push(r.key)
  }
  download(r: ResourceRecord) {
    return (
      'https://files.example.test/' +
      r.key +
      '?attname=' +
      encodeURIComponent(r.originalName)
    )
  }
}
export async function resourcesSuite(
  service: MemberService,
  store: Store,
  root: string,
  provider: TestResourceProvider,
  advance: (ms: number) => void,
) {
  const call = (
    token: string,
    method: string,
    path: string,
    body: unknown = {},
    q: Record<string, string> = {},
  ) => service.execute(token, method, '/api' + path, body, q)
  const stats = async () =>
    (await call(root, 'GET', '/members/stats')).data as MemberStats
  const before = await stats()
  const a = (
    await call(root, 'POST', '/members', {
      studentId: '00RESSTATS01',
      name: '资料统计测试',
    })
  ).data as Member
  const initial = await service.login(
    { studentId: a.studentId, password: '123456' },
    'resource-stat',
  )
  assert.equal((await stats()).activatedMembers, before.activatedMembers)
  await call(initial.token!, 'POST', '/auth/password', {
    oldPassword: '123456',
    newPassword: 'Resource-Test123',
  })
  let memberToken = (
    await service.login(
      { studentId: a.studentId, password: 'Resource-Test123' },
      'resource-stat',
    )
  ).token!
  assert.equal((await stats()).activatedMembers, before.activatedMembers + 1)
  await service.login(
    { studentId: a.studentId, password: 'Resource-Test123' },
    'resource-stat',
  )
  assert.equal(
    (await stats()).activatedMembers,
    before.activatedMembers + 1,
    'multiple logins count one member',
  )
  await call(root, 'POST', `/members/${a.uid}/password`)
  assert.equal(
    (await stats()).activatedMembers,
    before.activatedMembers,
    'reset pending initial password is excluded',
  )
  const resetLogin = await service.login(
    { studentId: a.studentId, password: '123456' },
    'resource-stat',
  )
  await call(resetLogin.token!, 'POST', '/auth/password', {
    oldPassword: '123456',
    newPassword: 'Resource-Reset123',
  })
  memberToken = (
    await service.login(
      { studentId: a.studentId, password: 'Resource-Reset123' },
      'resource-stat',
    )
  ).token!
  await assert.rejects(() => call(memberToken, 'GET', '/members/stats'), /权限/)
  await assert.rejects(
    () =>
      call(memberToken, 'POST', '/resources/uploads', {
        title: '越权',
        originalName: 'a.pdf',
        size: 50,
      }),
    /权限/,
  )
  await assert.rejects(
    () => call('', 'GET', '/resources', {}, { admin: 'true' }),
    /登录|会话/,
  )
  await assert.rejects(
    () =>
      call(root, 'POST', '/resources/uploads', {
        title: '不支持执行文件',
        originalName: 'a.exe',
        size: 50,
      }),
    /支持/,
  )
  await assert.rejects(() =>
    call(root, 'POST', '/resources/uploads', {
      title: '越界文件',
      originalName: '../a.pdf',
      size: 50,
    }),
  )
  const created = (
    await call(root, 'POST', '/resources/uploads', {
      title: 'PDF 资料 <script>',
      description: '社团公开参考',
      category: '基础教程',
      originalName: '基础.pdf',
      size: 100,
    })
  ).data as { id: string; token: string; key: string }
  assert.equal(created.token, 'test-upload-token')
  await assert.rejects(
    () => call(root, 'GET', `/resources/${created.id}/download`),
    /尚未发布|下架/,
  )
  provider.fail = true
  await assert.rejects(() =>
    call(root, 'POST', `/resources/${created.id}/complete`),
  )
  provider.fail = false
  await call(root, 'POST', `/resources/${created.id}/complete`)
  await call(root, 'POST', `/resources/${created.id}/update`, {
    title: 'PDF 资料 <script>',
    description: '社团公开参考',
    category: '基础教程',
    status: 'published',
  })
  const list = (
    await call(
      '',
      'GET',
      '/resources',
      {},
      { search: 'PDF', category: '基础教程' },
    )
  ).data as Page<ClubResource>
  assert.ok(list.items.some((r) => r.id === created.id))
  assert.ok(
    list.items.every(
      (r) =>
        !('key' in r) &&
        !('bucket' in r) &&
        !('ownerUid' in r) &&
        !('token' in r),
    ),
  )
  const download = (await call('', 'GET', `/resources/${created.id}/download`))
    .data as { url: string }
  assert.ok(
    download.url.startsWith(
      'https://files.example.test/electronicclub/resources/v1/',
    ),
  )
  await call(root, 'POST', `/resources/${created.id}/update`, {
    title: '已下架资料',
    description: '',
    category: '基础教程',
    status: 'draft',
  })
  await assert.rejects(
    () => call('', 'GET', `/resources/${created.id}/download`),
    /尚未发布|下架/,
  )
  const reserveBefore = (await store.read<{ bytes: number }>(
    'system',
    'resources:storage',
  ))!.bytes
  const attempts = await Promise.allSettled([
    call(root, 'POST', '/resources/uploads', {
      title: '并发1',
      originalName: 'a.pdf',
      size: 1100,
    }),
    call(root, 'POST', '/resources/uploads', {
      title: '并发2',
      originalName: 'b.pdf',
      size: 1100,
    }),
  ])
  assert.equal(
    attempts.filter((r) => r.status === 'fulfilled').length,
    1,
    'concurrent reservations stay within the resource budget',
  )
  const deletion = (await call(root, 'POST', `/resources/${created.id}/delete`))
    .data as { pending?: boolean }
  assert.equal(deletion.pending, true)
  assert.equal(
    provider.removed.length,
    0,
    'a live upload token must not permit post-deletion recreation outside quota',
  )
  assert.equal(
    (await store.read<{ bytes: number }>('system', 'resources:storage'))!.bytes,
    reserveBefore + 1100,
  )
  advance(631000)
  await call(root, 'POST', `/resources/${created.id}/delete`)
  assert.ok(provider.removed.includes(created.key))
  const budgetAfter = (await store.read<{ bytes: number }>(
    'system',
    'resources:storage',
  ))!.bytes
  await call(root, 'POST', `/resources/${created.id}/delete`)
  assert.equal(
    (await store.read<{ bytes: number }>('system', 'resources:storage'))!.bytes,
    budgetAfter,
  )
  await call(root, 'PATCH', `/members/${a.uid}/status`, { status: 'disabled' })
  assert.equal((await stats()).activatedMembers, before.activatedMembers)
  const cleanup = await cleanupResources(
    store,
    provider,
    Date.now() + 3 * 86400000,
  )
  assert.ok(cleanup.removed >= 1)
  assert.equal(
    (await store.read<{ bytes: number }>('system', 'resources:storage'))!.bytes,
    0,
  )
  const sqlSearch = (
    await call(
      '',
      'GET',
      '/resources',
      {},
      { search: "'; DROP TABLE users;--" },
    )
  ).data as Page<ClubResource>
  assert.equal(sqlSearch.total, 0)
  const role = (
    await call(root, 'POST', '/roles', {
      name: '资料管理员测试',
      description: '按动态权限授权',
      permissionIds: ['resources.manage'],
    })
  ).data as Role
  await call(root, 'PUT', `/members/${a.uid}/roles`, { roleIds: [role.id] })
  await call(root, 'PATCH', `/members/${a.uid}/status`, { status: 'active' })
  memberToken = (
    await service.login(
      { studentId: a.studentId, password: 'Resource-Reset123' },
      'resource-stat',
    )
  ).token!
  await call(memberToken, 'GET', '/resources/config')
  await call(memberToken, 'GET', '/resources', {}, { admin: 'true' })
  await call(root, 'PUT', `/roles/${role.id}`, {
    name: role.name,
    description: role.description,
    permissionIds: [],
  })
  await assert.rejects(
    () => call(memberToken, 'GET', '/resources/config'),
    /权限/,
  )
  return { resourceId: created.id }
}
