import assert from 'node:assert/strict'
import type {
  AccessMember,
  Member,
  Page,
  Role,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
export async function accessSuite(
  service: MemberService,
  store: Store,
  token: string,
) {
  const call = (
    method: string,
    path: string,
    body: unknown = {},
    query: Record<string, string> = {},
  ) => service.execute(token, method, '/api' + path, body, query)
  const createRole = async (name: string, permissionIds: string[]) =>
    (
      await call('POST', '/roles', {
        name,
        description: '授权工作台测试',
        permissionIds,
      })
    ).data as Role
  const a = await createRole('授权测试 A', ['members.read']),
    b = await createRole('授权测试 B', ['members.read'])
  const me = (await call('GET', '/auth/me')).data as { member: Member }
  const rootRole = await store.read<Role>('roles', me.member.roleIds[0])
  if (rootRole?.super && rootRole.memberCount === 1)
    await assert.rejects(
      () =>
        call('POST', `/roles/${rootRole.id}/members/${me.member.uid}`, {
          action: 'remove',
          replacementRoleId: a.id,
        }),
      /超级管理员/,
    )
  const user = (
    await call('POST', '/members', {
      studentId: '00ACCESS01',
      name: '角色名单测试',
    })
  ).data as Member
  const change = (
    role: string,
    action: 'add' | 'remove',
    replacementRoleId?: string,
  ) =>
    call('POST', `/roles/${role}/members/${user.uid}`, {
      action,
      ...(replacementRoleId ? { replacementRoleId } : {}),
    })
  assert.equal(
    (await change(a.id, 'add')).data &&
      (await store.read<Member>('users', user.uid))!.roleIds.includes(a.id),
    true,
  )
  const version = (await store.read<Member>('users', user.uid))!.version
  assert.deepEqual((await change(a.id, 'add')).data, {
    uid: user.uid,
    changed: false,
    roleIds: (await store.read<Member>('users', user.uid))!.roleIds,
  })
  assert.equal((await store.read<Member>('users', user.uid))!.version, version)
  await change(b.id, 'add')
  let roster = (
    await call(
      'GET',
      '/permissions/members.read/members',
      {},
      { search: '00ACCESS01' },
    )
  ).data as Page<AccessMember>
  assert.equal(roster.total, 1)
  assert.equal(roster.items[0].sources.length, 2)
  for (const field of [
    'phone',
    'email',
    'college',
    'activationExpiresAt',
    'version',
  ])
    assert.ok(!(field in roster.items[0]))
  assert.equal(
    (
      (
        await call(
          'GET',
          '/roles/member-lookup',
          {},
          { studentId: '00ACCESS01' },
        )
      ).data as AccessMember
    ).uid,
    user.uid,
  )
  await change(a.id, 'remove')
  roster = (
    await call(
      'GET',
      '/permissions/members.read/members',
      {},
      { search: '00ACCESS01' },
    )
  ).data as Page<AccessMember>
  assert.deepEqual(
    roster.items[0].sources.map((r) => r.id),
    [b.id],
  )
  assert.equal((await store.read<Role>('roles', a.id))!.memberCount, 0)
  assert.equal(
    (
      await call(
        'GET',
        `/roles/${b.id}/members`,
        {},
        { search: "'; DROP TABLE users;--" },
      )
    ).data && (await store.read<Member>('users', user.uid))!.name,
    '角色名单测试',
  )
  const rootPage = (await call('GET', '/permissions/forum.posts.pin/members'))
    .data as Page<AccessMember>
  assert.ok(rootPage.items.some((u) => u.sources.some((r) => r.super)))
  const initial = await service.login(
    { studentId: user.studentId, password: '123456' },
    'access-test',
  )
  await service.execute(
    initial.token!,
    'POST',
    '/api/auth/password',
    { oldPassword: '123456', newPassword: 'Access-Test123' },
    {},
  )
  const login = await service.login(
    { studentId: user.studentId, password: 'Access-Test123' },
    'access-test',
  )
  await assert.rejects(
    () =>
      service.execute(
        login.token!,
        'GET',
        `/api/roles/${b.id}/members`,
        {},
        {},
      ),
    /权限|授权/,
  )
  await assert.rejects(
    () =>
      service.execute(
        login.token!,
        'POST',
        `/api/roles/${a.id}/members/${user.uid}`,
        { action: 'add' },
        {},
      ),
    /权限|授权/,
  )
  await change(b.id, 'remove')
  await assert.rejects(
    () => service.execute(login.token!, 'GET', '/api/auth/me', {}, {}),
    /登录|会话/,
  )
  const only = (await store.read<Member>('users', user.uid))!.roleIds[0]
  await assert.rejects(() => change(only, 'remove'), /保留/)
  await change(only, 'remove', a.id)
  assert.deepEqual((await store.read<Member>('users', user.uid))!.roleIds, [
    a.id,
  ])
  await assert.rejects(() =>
    call('GET', `/roles/${a.id}/members`, {}, { pageSize: '100000' }),
  )
  return { roleId: a.id, uid: user.uid }
}
