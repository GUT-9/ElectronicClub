import assert from 'node:assert/strict'
import type {
  ClubEvent,
  EventAccess,
  EventCheckinState,
  EventManagerOption,
  EventRosterSummary,
  Identity,
  Member,
  Page,
  Registration,
  Role,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
export async function eventOperationsSuite(
  service: MemberService,
  store: Store,
  root: string,
  advance: (ms: number) => void,
  now: () => number,
) {
  const call = (
    token: string,
    method: string,
    path: string,
    body: unknown = {},
    q: Record<string, string> = {},
  ) => service.execute(token, method, '/api' + path, body, q)
  const denied = (fn: () => Promise<unknown>, code: string) =>
    assert.rejects(fn, (e: unknown) => (e as { code?: string }).code === code)
  const role = async (name: string, permissionIds: string[]) =>
    (
      await call(root, 'POST', '/roles', {
        name,
        description: '活动流程测试',
        permissionIds,
      })
    ).data as Role
  const make = async (id: string, name: string, roleIds?: string[]) => {
    const member = (
      await call(root, 'POST', '/members', {
        studentId: id,
        name,
        college: '电子学院',
        className: '物电2605',
      })
    ).data as Member
    if (roleIds)
      await call(root, 'PUT', `/members/${member.uid}/roles`, { roleIds })
    const initial = (
      await service.login({ studentId: id, password: '123456' }, 'ops-test')
    ).token!
    await call(initial, 'POST', '/auth/password', {
      oldPassword: '123456',
      newPassword: 'Event-Ops123',
    })
    return {
      member,
      token: (
        await service.login(
          { studentId: id, password: 'Event-Ops123' },
          'ops-test',
        )
      ).token!,
    }
  }
  const team = await role('活动测试组', []),
    secondTeam = await role('交叉测试组', []),
    reviewRole = await role('仅报名审核', ['events.registrations.review']),
    editorRole = await role('仅活动编辑', ['events.edit'])
  const manager = await make('00OPSMANAGER', '张负责人', [team.id]),
    teammate = await make('00OPSTEAM', '李负责人', [team.id, secondTeam.id]),
    reviewer = await make('00OPSREVIEW', '独立审核员', [reviewRole.id]),
    editor = await make('00OPSEDITOR', '活动编辑员', [editorRole.id]),
    attendee = await make('00OPSATTEND', '报名甲'),
    pending = await make('00OPSPENDING', '报名乙'),
    stranger = await make('00OPSSTRANGER', '其他成员')
  const rootMember = ((await call(root, 'GET', '/auth/me')).data as Identity)
    .member
  const roles = (await call(editor.token, 'GET', '/events/manager-roles'))
    .data as Page<{ id: string; name: string }>
  assert.ok(roles.items.some((r) => r.id === team.id))
  assert.ok(roles.items.every((r) => !('permissionIds' in r)))
  const search = (
    await call(
      editor.token,
      'GET',
      '/events/manager-options',
      {},
      { search: '张负责', pageSize: '1' },
    )
  ).data as Page<EventManagerOption>
  assert.equal(search.total, 1)
  assert.equal(search.items[0].uid, manager.member.uid)
  for (const field of [
    'studentId',
    'phone',
    'email',
    'college',
    'className',
    'activationExpiresAt',
    'version',
  ])
    assert.ok(!(field in search.items[0]))
  const batch = (
    await call(editor.token, 'POST', '/events/manager-options/by-role', {
      roleIds: [team.id, secondTeam.id],
    })
  ).data as { items: EventManagerOption[] }
  assert.equal(batch.items.length, 2)
  assert.equal(new Set(batch.items.map((m) => m.uid)).size, 2)
  await denied(
    () => call(stranger.token, 'GET', '/events/manager-options'),
    'FORBIDDEN',
  )
  await denied(
    () => call(reviewer.token, 'GET', '/events/manager-roles'),
    'FORBIDDEN',
  )
  const dates = {
    startsAt: new Date(now() + 60000).toISOString(),
    endsAt: new Date(now() + 10800000).toISOString(),
    registrationDeadline: new Date(now() + 7200000).toISOString(),
  }
  const event = (
    await call(root, 'POST', '/events', {
      title: '审核与签到完整流程',
      ...dates,
      status: 'published',
      registrationEnabled: true,
      approvalRequired: true,
      checkinEnabled: true,
      managerIds: batch.items.map((m) => m.uid),
    })
  ).data as ClubEvent
  assert.equal(event.managerIds.length, 3)
  assert.equal(event.checkinTtlSeconds, 1800)
  await call(root, 'POST', `/events/${event.id}/update`, {
    summary: '编辑后负责人仍保留',
    managerIds: [...event.managerIds, event.managerIds[0]],
  })
  const saved = (await call(root, 'GET', `/events/${event.id}`))
    .data as ClubEvent
  assert.deepEqual(saved.managerIds, event.managerIds)
  for (const uid of event.managerIds)
    assert.ok(await store.read('event_managers', `${event.id}:${uid}`))
  await denied(
    () =>
      call(manager.token, 'POST', `/events/${event.id}/update`, {
        managerIds: [manager.member.uid],
      }),
    'FORBIDDEN',
  )
  await call(manager.token, 'POST', `/events/${event.id}/update`, {
    managerIds: [...event.managerIds].reverse(),
    location: '仅此活动负责人可编辑',
  })
  // Role assignment is a snapshot; removing a role does not remove the activity assignment.
  await call(root, 'PUT', `/members/${manager.member.uid}/roles`, {
    roleIds: ['role_member'],
  })
  manager.token = (
    await service.login(
      { studentId: manager.member.studentId, password: 'Event-Ops123' },
      'ops-test',
    )
  ).token!
  assert.ok(
    (
      (await call(manager.token, 'GET', `/events/${event.id}/access`))
        .data as EventAccess
    ).checkin,
  )
  await call(root, 'PATCH', `/members/${teammate.member.uid}/status`, {
    status: 'disabled',
  })
  await call(root, 'POST', `/events/${event.id}/update`, {
    title: '保留停用负责人的历史授权',
  })
  const activeBatch = (
    await call(editor.token, 'POST', '/events/manager-options/by-role', {
      roleIds: [team.id],
    })
  ).data as { items: EventManagerOption[] }
  assert.equal(activeBatch.items.length, 0)
  const resolved = (
    await call(root, 'POST', '/events/manager-options/resolve', {
      uids: saved.managerIds,
    })
  ).data as { items: EventManagerOption[] }
  assert.ok(
    resolved.items.some(
      (m) => m.uid === teammate.member.uid && m.status === 'disabled',
    ),
  )
  await call(root, 'POST', `/events/${event.id}/registration`)
  await call(attendee.token, 'POST', `/events/${event.id}/registration`)
  await call(pending.token, 'POST', `/events/${event.id}/registration`)
  const page = (
    await call(
      reviewer.token,
      'GET',
      `/events/${event.id}/registrations`,
      {},
      { pageSize: '1' },
    )
  ).data as Page<Registration> & { summary: EventRosterSummary }
  assert.equal(page.items.length, 1)
  assert.equal(page.total, 3)
  assert.equal(page.summary.pending, 3)
  assert.ok(
    (
      (await call(reviewer.token, 'GET', `/events/${event.id}/access`))
        .data as EventAccess
    ).roster,
    'Review-only permission can open the roster',
  )
  await denied(
    () =>
      call(
        reviewer.token,
        'GET',
        `/events/${event.id}/registrations/export.xlsx`,
      ),
    'EVENT_SCOPE',
  )
  await denied(
    () => call(stranger.token, 'GET', `/events/${event.id}/registrations`),
    'EVENT_SCOPE',
  )
  const found = (
    await call(
      manager.token,
      'GET',
      `/events/${event.id}/registrations`,
      {},
      { search: '报名甲' },
    )
  ).data as Page<Registration>
  assert.equal(found.total, 1)
  assert.equal(found.items[0].uid, attendee.member.uid)
  const literal = (
    await call(
      manager.token,
      'GET',
      `/events/${event.id}/registrations`,
      {},
      { search: "'; DROP TABLE users;--" },
    )
  ).data as Page<Registration>
  assert.equal(literal.total, 0)
  assert.ok(await store.read('users', rootMember.uid))
  await call(reviewer.token, 'POST', `/events/${event.id}/review`, {
    uid: attendee.member.uid,
    status: 'approved',
  })
  await call(root, 'POST', `/events/${event.id}/review`, {
    uid: rootMember.uid,
    status: 'approved',
  })
  const checkin = (
    await call(manager.token, 'POST', `/events/${event.id}/checkin-code`, {
      open: true,
      ttlSeconds: 3600,
    })
  ).data as EventCheckinState
  assert.equal(checkin.ttlSeconds, 3600)
  assert.equal(Date.parse(checkin.expiresAt!) - now(), 3600000)
  assert.equal(
    ((await call(root, 'GET', `/events/${event.id}`)).data as ClubEvent)
      .checkinTtlSeconds,
    3600,
  )
  const current = (
    await call(manager.token, 'GET', `/events/${event.id}/checkin-status`)
  ).data as Record<string, unknown>
  assert.equal(current.open, true)
  assert.ok(!('code' in current) && !('hash' in current))
  await denied(
    () => call(stranger.token, 'GET', `/events/${event.id}/checkin-status`),
    'EVENT_SCOPE',
  )
  await denied(
    () =>
      call(pending.token, 'POST', `/events/${event.id}/checkin`, {
        code: checkin.code,
      }),
    'REGISTRATION_REQUIRED',
  )
  advance(5 * 60000)
  await call(attendee.token, 'POST', `/events/${event.id}/checkin`, {
    code: checkin.code,
  })
  await call(attendee.token, 'POST', `/events/${event.id}/checkin`, {
    code: checkin.code,
  })
  assert.ok(
    (await store.read<Registration>(
      'registrations',
      `${event.id}:${attendee.member.uid}`,
    ))!.checkedInAt,
  )
  const rotated = (
    await call(manager.token, 'POST', `/events/${event.id}/checkin-code`, {
      open: true,
      ttlSeconds: 60,
    })
  ).data as EventCheckinState
  await denied(
    () =>
      call(root, 'POST', `/events/${event.id}/checkin`, { code: checkin.code }),
    'INVALID_CHECKIN_CODE',
  )
  advance(61000)
  await denied(
    () =>
      call(root, 'POST', `/events/${event.id}/checkin`, { code: rotated.code }),
    'INVALID_CHECKIN_CODE',
  )
  assert.equal(
    (
      (await call(root, 'GET', `/events/${event.id}/checkin-status`))
        .data as EventCheckinState
    ).open,
    false,
  )
  await call(manager.token, 'POST', `/events/${event.id}/manual-checkin`, {
    uid: pending.member.uid,
    reason: '现场确认已符合报名条件',
  })
  await denied(
    () =>
      call(manager.token, 'POST', `/events/${event.id}/manual-checkin`, {
        uid: teammate.member.uid,
        reason: '停用成员不能补签',
      }),
    'INVALID_MEMBER',
  )
  assert.equal(
    (await store.read<Registration>(
      'registrations',
      `${event.id}:${pending.member.uid}`,
    ))!.status,
    'approved',
  )
  assert.equal(
    (await store.read<Registration>(
      'registrations',
      `${event.id}:${pending.member.uid}`,
    ))!.reviewedBy,
    manager.member.uid,
  )
  await call(stranger.token, 'POST', `/events/${event.id}/registration`)
  await call(stranger.token, 'DELETE', `/events/${event.id}/registration`)
  const occupied = (await store.read<ClubEvent>('events', event.id))!.occupied
  await call(manager.token, 'POST', `/events/${event.id}/manual-checkin`, {
    uid: stranger.member.uid,
    reason: '已取消报名但到场，需要人工记录',
  })
  assert.equal(
    (await store.read<Registration>(
      'registrations',
      `${event.id}:${stranger.member.uid}`,
    ))!.status,
    'manual',
  )
  assert.equal(
    (await store.read<ClubEvent>('events', event.id))!.occupied,
    occupied,
  )
  const active = (
    await call(manager.token, 'POST', `/events/${event.id}/checkin-code`, {
      open: true,
      ttlSeconds: 7200,
    })
  ).data as EventCheckinState
  await call(root, 'POST', `/events/${event.id}/update`, {
    checkinEnabled: false,
  })
  await call(manager.token, 'POST', `/events/${event.id}/checkin-code`, {
    open: false,
  })
  await call(root, 'POST', `/events/${event.id}/update`, {
    checkinEnabled: true,
    registrationEnabled: false,
  })
  await denied(
    () =>
      call(root, 'POST', `/events/${event.id}/checkin`, { code: active.code }),
    'INVALID_CHECKIN_CODE',
  )
  const after = (
    await call(manager.token, 'POST', `/events/${event.id}/checkin-code`, {
      open: true,
    })
  ).data as EventCheckinState
  assert.equal(after.ttlSeconds, 7200, 'Configured TTL persists and is reused')
  await call(root, 'POST', `/events/${event.id}/checkin`, { code: after.code })
  await assert.rejects(
    () =>
      call(manager.token, 'POST', `/events/${event.id}/checkin-code`, {
        open: true,
        ttlSeconds: 86401,
      }),
    (e: unknown) => (e as Error).name === 'ZodError',
  )
  assert.ok(
    (
      await call(
        manager.token,
        'GET',
        `/events/${event.id}/registrations/export.xlsx`,
      )
    ).binary,
  )
  return { eventId: event.id }
}
