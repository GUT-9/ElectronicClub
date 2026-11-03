import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import type {
  Member,
  ClubEvent,
  ClubArticle,
  Role,
  Registration,
  PopupAnnouncement,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
export async function stage3Suite(
  service: MemberService,
  store: Store,
  rootToken: string,
) {
  const call = (
    token: string,
    method: string,
    path: string,
    body: unknown = {},
    query: Record<string, string> = {},
  ) => service.execute(token, method, path, body, query)
  const base = '/api/events',
    now = Date.now(),
    date = (n: number) => new Date(now + n).toISOString()
  const eventData = {
    title: '自动测试活动',
    summary: '仅测试数据',
    content: '## 测试\n<script>alert(1)</script>',
    cover: '',
    location: '测试地点',
    startsAt: date(86400000),
    endsAt: date(172800000),
    status: 'published',
    registrationEnabled: true,
    registrationStartsAt: '',
    registrationDeadline: date(3600000),
    capacity: 1,
    allowCancellation: true,
    approvalRequired: false,
    notesEnabled: true,
    notesRequired: false,
    checkinEnabled: true,
    managerIds: [] as string[],
  }
  const users: { member: Member; token: string }[] = []
  for (let i = 0; i < 15; i++) {
    const member = (
      await call(rootToken, 'POST', '/api/members', {
        studentId: `00stage3${i}`,
        name: `Test ${i}`,
        college: '测试学院',
        className: '测试班级',
      })
    ).data as Member
    const first = await service.login(
      { studentId: member.studentId, password: '123456' },
      `test-${i}`,
    )
    await call(first.token!, 'POST', '/api/auth/password', {
      oldPassword: '123456',
      newPassword: 'TestMember123',
    })
    users.push({
      member,
      token: (
        await service.login(
          { studentId: member.studentId, password: 'TestMember123' },
          `test-${i}`,
        )
      ).token!,
    })
  }
  await assert.rejects(() => call('', 'POST', base, eventData))
  await assert.rejects(() =>
    call(users[0]!.token, 'POST', '/api/articles', {
      title: '越权',
      content: 'text',
    }),
  )
  const role = (
    await call(rootToken, 'POST', '/api/roles', {
      name: '仅活动创建',
      description: '测试',
      permissionIds: ['events.create'],
    })
  ).data as Role
  await call(rootToken, 'PUT', `/api/members/${users[0]!.member.uid}/roles`, {
    roleIds: ['role_member', role.id],
  })
  users[0]!.token = (
    await service.login(
      { studentId: users[0]!.member.studentId, password: 'TestMember123' },
      'role-refresh',
    )
  ).token!
  await assert.rejects(() =>
    call(
      users[0]!.token,
      'GET',
      '/api/events/manager-lookup',
      {},
      { studentId: users[1]!.member.studentId },
    ),
  )
  const lookup = (
    await call(
      rootToken,
      'GET',
      '/api/events/manager-lookup',
      {},
      { studentId: users[1]!.member.studentId },
    )
  ).data as { uid: string }
  assert.equal(lookup.uid, users[1]!.member.uid)
  const owned = (await call(users[0]!.token, 'POST', base, eventData))
    .data as ClubEvent
  assert.ok(owned.managerIds.includes(users[0]!.member.uid))
  const other = (await call(rootToken, 'POST', base, eventData))
    .data as ClubEvent
  await assert.rejects(() =>
    call(users[0]!.token, 'PATCH', `${base}/${other.id}`, eventData),
  )
  await assert.rejects(() => call(users[0]!.token, 'GET', '/api/members'))
  const closed = (
    await call(rootToken, 'POST', base, {
      ...eventData,
      registrationEnabled: false,
    })
  ).data as ClubEvent
  await assert.rejects(() =>
    call(users[1]!.token, 'POST', `${base}/${closed.id}/registration`, {}),
  )
  const expired = (
    await call(rootToken, 'POST', base, {
      ...eventData,
      registrationDeadline: date(-1000),
    })
  ).data as ClubEvent
  await assert.rejects(() =>
    call(users[1]!.token, 'POST', `${base}/${expired.id}/registration`, {}),
  )
  const results = await Promise.allSettled(
    users.map((user) =>
      call(user.token, 'POST', `${base}/${other.id}/registration`, {
        note: '=HYPERLINK("https://example.test","test")',
      }),
    ),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal((await store.read<ClubEvent>('events', other.id))!.occupied, 1)
  const winner = users[results.findIndex((r) => r.status === 'fulfilled')]!
  await assert.rejects(() =>
    call(winner.token, 'POST', `${base}/${other.id}/registration`, {}),
  )
  await assert.rejects(() =>
    call(winner.token, 'POST', `${base}/${other.id}/registration`, {
      name: '伪造姓名',
    }),
  )
  await call(rootToken, 'PATCH', `/api/members/${winner.member.uid}`, {
    college: '更新后学院',
  })
  winner.token = (
    await service.login(
      { studentId: winner.member.studentId, password: 'TestMember123' },
      'profile-refresh',
    )
  ).token!
  const exported = await call(
    rootToken,
    'GET',
    `${base}/${other.id}/registrations/export.xlsx`,
  )
  assert.ok(exported.binary)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(exported.binary as unknown as ExcelJS.Buffer)
  const sheet = book.worksheets[0]!
  assert.equal(sheet.getRow(2).getCell(2).type, ExcelJS.ValueType.String)
  assert.equal(sheet.getRow(2).getCell(2).text, winner.member.studentId)
  assert.equal(sheet.getRow(2).getCell(9).type, ExcelJS.ValueType.String)
  assert.ok(sheet.getRow(2).getCell(9).text.startsWith('='))
  assert.equal(sheet.getRow(2).getCell(5).text, '测试学院')
  const secret = await call(
    rootToken,
    'POST',
    `${base}/${other.id}/checkin-code`,
    { open: true, ttlSeconds: 30 },
  )
  const code = (secret.data as { code: string }).code
  const nonwinner = users.find((u) => u !== winner)!
  await assert.rejects(() =>
    call(nonwinner.token, 'POST', `${base}/${other.id}/checkin`, { code }),
  )
  await call(winner.token, 'POST', `${base}/${other.id}/checkin`, { code })
  await call(winner.token, 'POST', `${base}/${other.id}/checkin`, { code })
  assert.ok(await store.read('checkins', `${other.id}:${winner.member.uid}`))
  await store.run(async (tx) => {
    const record = (await tx.get<{ hash: string; expiresAt: number }>(
      'system',
      `checkin:${other.id}`,
    ))!
    await tx.set('system', `checkin:${other.id}`, { ...record, expiresAt: 0 })
  })
  await assert.rejects(() =>
    call(winner.token, 'POST', `${base}/${other.id}/checkin`, { code }),
  )
  const review = (
    await call(rootToken, 'POST', base, {
      ...eventData,
      approvalRequired: true,
      capacity: 2,
      managerIds: [users[0]!.member.uid],
    })
  ).data as ClubEvent
  await call(users[2]!.token, 'POST', `${base}/${review.id}/registration`, {})
  await call(users[2]!.token, 'DELETE', `${base}/${review.id}/registration`)
  assert.equal((await store.read<ClubEvent>('events', review.id))!.occupied, 0)
  await call(users[2]!.token, 'POST', `${base}/${review.id}/registration`, {})
  await call(users[0]!.token, 'POST', `${base}/${review.id}/review`, {
    uid: users[2]!.member.uid,
    status: 'approved',
  })
  const r = await store.read<Registration>(
    'registrations',
    `${review.id}:${users[2]!.member.uid}`,
  )
  assert.equal(r!.status, 'approved')
  assert.ok(
    (
      await call(
        users[0]!.token,
        'GET',
        `${base}/${review.id}/registrations/export.xlsx`,
      )
    ).binary,
  )
  await call(users[0]!.token, 'POST', `${base}/${review.id}/manual-checkin`, {
    uid: users[4]!.member.uid,
    reason: '经负责人确认现场参加',
  })
  assert.equal(
    (await store.read<Registration>(
      'registrations',
      `${review.id}:${users[4]!.member.uid}`,
    ))!.status,
    'manual',
  )
  await call(users[3]!.token, 'POST', `${base}/${review.id}/registration`, {})
  await call(users[3]!.token, 'DELETE', `${base}/${review.id}/registration`)
  await call(users[0]!.token, 'POST', `${base}/${review.id}/manual-checkin`, {
    uid: users[3]!.member.uid,
    reason: '补签已取消报名成员',
  })
  await assert.rejects(() =>
    call(users[3]!.token, 'POST', `${base}/${review.id}/registration`, {}),
  )
  const article = (
    await call(rootToken, 'POST', '/api/articles', {
      title: '测试文章',
      content: '<img src=x onerror=alert(1)>',
      status: 'published',
    })
  ).data as ClubArticle
  const publishRole = (
    await call(rootToken, 'POST', '/api/roles', {
      name: '仅文章发布',
      description: '测试',
      permissionIds: ['articles.publish'],
    })
  ).data as Role
  await call(rootToken, 'PUT', `/api/members/${users[1]!.member.uid}/roles`, {
    roleIds: ['role_member', publishRole.id],
  })
  users[1]!.token = (
    await service.login(
      { studentId: users[1]!.member.studentId, password: 'TestMember123' },
      'publisher-refresh',
    )
  ).token!
  await call(users[1]!.token, 'POST', `/api/articles/${article.id}/publish`, {
    publish: false,
  })
  await assert.rejects(() =>
    call('', 'GET', `/api/public/articles/${article.id}`),
  )
  await call(users[1]!.token, 'POST', `/api/articles/${article.id}/publish`, {
    publish: true,
  })
  await assert.rejects(() =>
    call(users[1]!.token, 'PATCH', `/api/articles/${article.id}`, {
      title: '越权修改',
      content: 'text',
    }),
  )
  const popup = {
    title: '测试公告',
    summary: '测试',
    targetType: 'article',
    targetId: article.id,
    startsAt: date(-60000),
    expiresAt: date(3600000),
    priority: 99,
  }
  await assert.rejects(() =>
    call(users[0]!.token, 'POST', '/api/popups', popup),
  )
  const first = (await call(rootToken, 'POST', '/api/popups', popup))
    .data as PopupAnnouncement
  assert.equal(
    ((await call('', 'GET', '/api/public/popup')).data as PopupAnnouncement).id,
    first.id,
  )
  const future = (
    await call(rootToken, 'POST', '/api/popups', {
      ...popup,
      title: '未来公告',
      startsAt: date(60000),
      priority: 10,
    })
  ).data as PopupAnnouncement
  assert.equal(
    ((await call('', 'GET', '/api/public/popup')).data as PopupAnnouncement).id,
    first.id,
  )
  const second = (
    await call(rootToken, 'POST', '/api/popups', {
      ...popup,
      title: '替换公告',
      priority: 0,
      startsAt: date(-1000),
    })
  ).data as PopupAnnouncement
  assert.equal(
    ((await call('', 'GET', '/api/public/popup')).data as PopupAnnouncement).id,
    second.id,
  )
  assert.equal(
    (await store.read<PopupAnnouncement>('popup_announcements', first.id))!
      .state,
    'retired',
  )
  await store.run((tx) =>
    tx.set('popup_announcements', future.id, {
      ...future,
      startsAt: date(-500),
    }),
  )
  const selected = await Promise.all([
    call('', 'GET', '/api/public/popup'),
    call('', 'GET', '/api/public/popup'),
  ])
  assert.ok(
    selected.every((r) => (r.data as PopupAnnouncement).id === future.id),
  )
  const publicList = await call('', 'GET', '/api/public/events')
  assert.ok((publicList.data as { items: unknown[] }).items.length)
  assert.ok((await call(rootToken, 'GET', '/api/audit')).data)
  const { cleanStage3Privacy } = await import(
    '../../apps/functions/src/stage3/privacy'
  )
  await cleanStage3Privacy(store, winner.member.uid)
  assert.equal(
    (await store.read<Registration>(
      'registrations',
      `${other.id}:${winner.member.uid}`,
    ))!.snapshot.studentId,
    '',
  )
  assert.equal(
    (await store.read<Registration>(
      'registrations',
      `${other.id}:${winner.member.uid}`,
    ))!.note,
    '',
  )
}
