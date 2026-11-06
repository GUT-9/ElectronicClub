import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  AuditLog,
  Identity,
  ImportJob,
  Member,
  Page,
  Role,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
import { digest, studentIdKey } from '../../apps/functions/src/members/crypto'

export async function memberPurgeSuite(
  service: MemberService,
  store: Store,
  root: string,
) {
  const call = (
    token: string,
    method: string,
    path: string,
    body: unknown = {},
  ) => service.execute(token, method, '/api' + path, body, {})
  const rejects = (fn: () => Promise<unknown>, code: string) =>
    assert.rejects(fn, (e: unknown) => (e as { code?: string }).code === code)
  const create = async (studentId: string) =>
    (await call(root, 'POST', '/members', { studentId, name: '彻底删除测试' }))
      .data as Member
  const purge = (
    token: string,
    user: Member,
    body: unknown = { confirmUid: user.uid },
  ) => call(token, 'POST', `/members/${user.uid}/purge`, body)
  const rootMember = ((await call(root, 'GET', '/auth/me')).data as Identity)
    .member
  const member = await create('00PURGE01')
  const adminRole = await store.read<Role>('roles', 'role_admin')
  assert.ok(
    !adminRole!.permissionIds.includes('members.purge'),
    'Not automatically granted to ordinary administrators',
  )
  await rejects(() => purge(root, rootMember), 'PURGE_SELF')
  await rejects(() => purge(root, member), 'PURGE_NOT_DELETED')
  const initial = (
    await service.login(
      { studentId: member.studentId, password: '123456' },
      'purge-test',
    )
  ).token!
  await call(initial, 'POST', '/auth/password', {
    oldPassword: '123456',
    newPassword: 'Purge-Test123',
  })
  const memberToken = (
    await service.login(
      { studentId: member.studentId, password: 'Purge-Test123' },
      'purge-test',
    )
  ).token!
  await rejects(() => purge(memberToken, rootMember), 'FORBIDDEN')

  const operator = await create('00PURGEADMIN')
  const activate = (
    await service.login(
      { studentId: operator.studentId, password: '123456' },
      'purge-test',
    )
  ).token!
  await call(activate, 'POST', '/auth/password', {
    oldPassword: '123456',
    newPassword: 'Purge-Admin123',
  })
  const role = (
    await call(root, 'POST', '/roles', {
      name: '彻底删除操作员',
      description: '',
      permissionIds: ['members.read', 'members.purge'],
    })
  ).data as Role
  await call(root, 'PUT', `/members/${operator.uid}/roles`, {
    roleIds: [role.id],
  })
  const operatorToken = (
    await service.login(
      { studentId: operator.studentId, password: 'Purge-Admin123' },
      'purge-test',
    )
  ).token!
  // Revoking a permission takes effect in an existing session, without hardcoded positions.
  await call(root, 'PUT', `/roles/${role.id}`, {
    name: role.name,
    description: '',
    permissionIds: ['members.read'],
  })
  await rejects(() => purge(operatorToken, member), 'FORBIDDEN')
  await call(root, 'PUT', `/roles/${role.id}`, {
    name: role.name,
    description: '',
    permissionIds: ['members.read', 'members.purge'],
  })

  const importId = randomUUID(),
    loginId = randomUUID()
  const other = await create('00PURGEOTHER')
  const rows = [
    {
      line: 2,
      uid: member.uid,
      member: {
        studentId: member.studentId,
        name: member.name,
        gender: member.gender,
        college: '',
        major: '',
        className: '',
        grade: '',
      },
    },
    {
      line: 3,
      uid: other.uid,
      member: {
        studentId: other.studentId,
        name: other.name,
        gender: other.gender,
        college: '',
        major: '',
        className: '',
        grade: '',
      },
    },
    {
      line: 4,
      member: {
        studentId: member.studentId.toLowerCase(),
        name: member.name,
        gender: member.gender,
        college: '',
        major: '',
        className: '',
        grade: '',
      },
    },
  ]
  await store.run(async (tx) => {
    await tx.set('import_jobs', importId, {
      id: importId,
      owner: rootMember.uid,
      hash: 'purge-fixture',
      rows,
      offset: 3,
      created: 2,
      skipped: 0,
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await tx.set('audit_logs', loginId, {
      id: loginId,
      actor: member.uid,
      action: 'auth.login',
      target: member.uid,
      fields: [],
      createdAt: new Date().toISOString(),
      login: {
        memberUid: member.uid,
        ip: '203.0.113.15',
        userAgent: 'Purge Test Browser',
      },
    })
  })
  await call(root, 'DELETE', `/members/${member.uid}`)
  await rejects(() => call(memberToken, 'GET', '/auth/me'), 'SESSION_REVOKED')
  await rejects(
    () => purge(root, member, { confirmUid: other.uid }),
    'PURGE_CONFIRMATION',
  )
  const count = (await store.read<Role>('roles', 'role_member'))!.memberCount
  assert.deepEqual((await purge(operatorToken, member)).data, {
    uid: member.uid,
    deleted: true,
  })
  assert.equal(await store.read('users', member.uid), null)
  assert.equal(await store.read('credentials', member.uid), null)
  assert.equal(await store.read('sessions', digest(memberToken)), null)
  assert.equal(await store.read('sessions', digest(initial)), null)
  assert.equal(
    await store.read('student_ids', studentIdKey(member.studentId)),
    null,
  )
  assert.equal(
    (await store.read<Role>('roles', 'role_member'))!.memberCount,
    count - 1,
  )
  const imported = (await store.read<ImportJob>('import_jobs', importId))!
  assert.equal(imported.offset, 3)
  assert.equal(imported.rows.length, 3)
  for (const index of [0, 2]) {
    assert.equal(imported.rows[index].member, undefined)
    assert.equal(imported.rows[index].uid, undefined)
  }
  assert.deepEqual(imported.rows[1], rows[1])
  assert.equal(
    (await store.read<{ login?: unknown }>('audit_logs', loginId))!.login,
    undefined,
  )
  const logs = (await call(root, 'GET', '/audit')).data as Page<AuditLog>
  assert.ok(
    logs.items.some(
      (log) =>
        log.action === 'members.purge' &&
        log.target === member.uid &&
        log.actor === operator.uid,
    ),
  )
  assert.equal(
    (
      await service.login(
        { studentId: member.studentId, password: 'Purge-Test123' },
        'purge-test',
      )
    ).status,
    401,
  )
  await rejects(
    () => call(root, 'POST', `/members/${member.uid}/restore`),
    'NOT_FOUND',
  )
  assert.notEqual(
    (await create(member.studentId)).uid,
    member.uid,
    'Student ID may be reused with a fresh UID',
  )

  // JSON-only publisher references must block deletion too; no cascading content loss.
  const linked = await create('00PURGELINKED')
  const articleId = randomUUID()
  await store.run((tx) =>
    tx.set('articles', articleId, {
      id: articleId,
      publisherUid: linked.uid,
      publisherName: linked.name,
      title: '保留历史',
      content: '不得连带删除',
      status: 'deleted',
      createdAt: new Date().toISOString(),
    }),
  )
  await call(root, 'DELETE', `/members/${linked.uid}`)
  const before = (await store.read<Role>('roles', 'role_member'))!.memberCount
  await rejects(() => purge(root, linked), 'MEMBER_HAS_HISTORY')
  assert.ok(await store.read('users', linked.uid))
  assert.ok(await store.read('credentials', linked.uid))
  assert.equal(
    (await store.read<Role>('roles', 'role_member'))!.memberCount,
    before,
    'Blocked purge rolls back role counts',
  )
  assert.equal(
    (await store.read<{ content: string }>('articles', articleId))!.content,
    '不得连带删除',
  )
  await call(root, 'POST', `/members/${linked.uid}/anonymize`)
  assert.ok((await store.read<Member>('users', linked.uid))!.anonymizedAt)

  const pending = await create('00PURGEPENDING')
  await call(root, 'DELETE', `/members/${pending.uid}`)
  await call(root, 'POST', `/members/${pending.uid}/anonymize`)
  await rejects(() => purge(root, pending), 'PRIVACY_CLEANUP_PENDING')
  await store.run((tx) =>
    tx.set('privacy_jobs', pending.uid, {
      uid: pending.uid,
      status: 'completed',
    }),
  )
  await purge(root, pending)
  assert.equal(await store.read('privacy_jobs', pending.uid), null)

  const concurrent = await create('00PURGECONCURRENT')
  await call(root, 'DELETE', `/members/${concurrent.uid}`)
  const results = await Promise.allSettled([
    purge(root, concurrent),
    purge(root, concurrent),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    results.filter(
      (r) => r.status === 'rejected' && r.reason.code === 'NOT_FOUND',
    ).length,
    1,
  )
  assert.ok(
    (await call(root, 'GET', '/auth/me')).data,
    'Original super administrator is unaffected',
  )
}
