import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import type {
  ForumBoard,
  ForumPost,
  ForumComment,
  ForumReport,
  ForumNotification,
  Member,
  Role,
  Page,
} from '../../packages/shared/src/index'
import {
  DEFAULT_FORUM_BOARDS,
  FORUM_PERMISSIONS,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
import { inspectImage } from '../../apps/functions/src/forum/images'
export function testPng() {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type),
      body = Buffer.concat([name, data])
    let crc = 0xffffffff
    for (const b of body) {
      crc ^= b
      for (let n = 0; n < 8; n++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    const out = Buffer.alloc(data.length + 12)
    out.writeUInt32BE(data.length)
    body.copy(out, 4)
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2)
  header.writeUInt32BE(2, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.from([
    0, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 0, 0, 255, 255,
  ])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
export async function forumSuite(
  service: MemberService,
  store: Store,
  rootToken: string,
  advance: (ms: number) => void,
) {
  const call = (
    token: string,
    method: string,
    path: string,
    body: unknown = {},
    q: Record<string, string> = {},
  ) => service.execute(token, method, '/api/forum' + path, body, q)
  const root = (
    m: string,
    p: string,
    b: unknown = {},
    q: Record<string, string> = {},
  ) => call(rootToken, m, p, b, q)
  const rejected = (fn: () => Promise<unknown>, status?: number) =>
    status
      ? assert.rejects(
          fn,
          (e: unknown) => (e as { status: number }).status === status,
        )
      : assert.rejects(fn)

  for (const board of DEFAULT_FORUM_BOARDS)
    if (!(await store.read('forum_boards', board.id)))
      await store.run((tx) =>
        tx.set('forum_boards', board.id, {
          ...board,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      )
  const users: { token: string; member: Member }[] = []
  for (let n = 0; n < 3; n++) {
    const member = (
      await service.execute(
        rootToken,
        'POST',
        '/api/members',
        {
          studentId: `00FORUM${n}`,
          name: `Forum test ${n}`,
          college: 'PRIVATE_COLLEGE',
          phone: '13800000000',
        },
        {},
      )
    ).data as Member
    const login = await service.login(
      { studentId: member.studentId, password: '123456' },
      'forum-' + n,
    )
    await service.execute(
      login.token!,
      'POST',
      '/api/auth/password',
      { oldPassword: '123456', newPassword: 'ForumTest123' },
      {},
    )
    users.push({
      member,
      token: (
        await service.login(
          { studentId: member.studentId, password: 'ForumTest123' },
          'forum-' + n,
        )
      ).token!,
    })
  }
  const [a, b, c] = users as [
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
  ]
  const callA = (
    m: string,
    p: string,
    d: unknown = {},
    q: Record<string, string> = {},
  ) => call(a.token, m, p, d, q)
  const data = {
    title: '工程实践讨论',
    body: '## 标题\n<script>window.FORUM_XSS=1</script>\n- 焊接与调试',
    boardId: 'board-1',
    imageIds: [] as string[],
  }
  await rejected(() => call('', 'POST', '/posts', data), 401)
  await rejected(() => callA('POST', '/boards', { name: '越权' }), 403)
  const board = (
    await root('POST', '/boards', {
      name: '需要审核',
      description: 'Only test',
      position: 9,
      requireReview: true,
    })
  ).data as ForumBoard
  const png = testPng(),
    uri = 'data:image/png;base64,' + png.toString('base64')
  assert.equal(inspectImage(uri).width, 2)
  const image = (await callA('POST', '/images', { dataUrl: uri })).data as {
    id: string
  }
  await rejected(() => call('', 'GET', '/images/' + image.id), 404)
  await rejected(
    () => call(b.token, 'POST', '/posts', { ...data, imageIds: [image.id] }),
    403,
  )
  const post = (
    await callA('POST', '/posts', { ...data, imageIds: [image.id] })
  ).data as ForumPost
  assert.equal(post.status, 'published')
  assert.equal(post.authorUid, a.member.uid)
  const publicPost = (await call('', 'GET', '/posts/' + post.id))
    .data as ForumPost
  assert.equal(publicPost.body, data.body)
  const publicText = JSON.stringify(publicPost)
  assert.ok(!publicText.includes(a.member.studentId))
  assert.ok(!publicText.includes('PRIVATE_COLLEGE'))
  assert.ok(!publicText.includes('13800000000'))
  assert.deepEqual((await call('', 'GET', '/images/' + image.id)).binary, png)
  await rejected(
    () =>
      call(c.token, 'POST', '/posts/' + post.id + '/update', {
        ...data,
        title: '盗改',
      }),
    403,
  )
  await rejected(() =>
    callA('POST', '/posts/' + post.id + '/update', {
      ...data,
      authorUid: c.member.uid,
    }),
  )
  await callA('POST', '/posts/' + post.id + '/update', {
    ...data,
    title: '本人修改成功',
    imageIds: [image.id],
  })
  assert.equal(
    ((await call('', 'GET', '/posts/' + post.id)).data as ForumPost).title,
    '本人修改成功',
  )
  await rejected(() => callA('POST', '/posts', data), 429)
  const role = (
    await service.execute(
      rootToken,
      'POST',
      '/api/roles',
      {
        name: '论坛专用管理员',
        description: 'No member database access',
        permissionIds: [...FORUM_PERMISSIONS],
      },
      {},
    )
  ).data as Role
  await service.execute(
    rootToken,
    'PUT',
    '/api/members/' + c.member.uid + '/roles',
    { roleIds: [role.id] },
    {},
  )
  c.token = (
    await service.login(
      { studentId: c.member.studentId, password: 'ForumTest123' },
      'forum-moderator',
    )
  ).token!
  await rejected(
    () => service.execute(c.token, 'GET', '/api/members', {}, {}),
    403,
  )
  await call(c.token, 'POST', '/posts/' + post.id + '/moderate', {
    action: 'pin',
    value: true,
    reason: 'Useful discussion',
  })
  await call(c.token, 'POST', '/posts/' + post.id + '/moderate', {
    action: 'feature',
    value: true,
    reason: 'Verified project',
  })
  await rejected(
    () =>
      callA('POST', '/posts/' + post.id + '/moderate', {
        action: 'pin',
        value: true,
        reason: 'Forged',
      }),
    403,
  )
  const featured = (await call('', 'GET', '/posts', {}, { sort: 'featured' }))
    .data as Page<ForumPost>
  assert.ok(featured.items.some((p) => p.id === post.id))
  const comment = (
    await call(b.token, 'POST', '/posts/' + post.id + '/comments', {
      body: 'First reply',
    })
  ).data as ForumComment
  const nested = (
    await callA('POST', '/posts/' + post.id + '/comments', {
      body: 'Reply to member',
      parentId: comment.id,
    })
  ).data as ForumComment
  assert.equal(nested.floor, 2)
  assert.equal(nested.parentId, comment.id)
  const notifications = (await call(b.token, 'GET', '/me/notifications'))
    .data as Page<ForumNotification>
  assert.equal(notifications.total, 1)
  await rejected(
    () => callA('POST', '/me/notifications/' + notifications.items[0]!.id),
    404,
  )
  await call(b.token, 'POST', '/me/notifications/' + notifications.items[0]!.id)
  assert.equal(
    (
      (await call(b.token, 'GET', '/me/notifications'))
        .data as Page<ForumNotification>
    ).items[0]!.read,
    true,
  )
  await Promise.all([
    call(b.token, 'POST', '/posts/' + post.id + '/like', { active: true }),
    call(b.token, 'POST', '/posts/' + post.id + '/like', { active: true }),
  ])
  assert.equal(
    ((await call('', 'GET', '/posts/' + post.id)).data as ForumPost).likeCount,
    1,
  )
  await call(b.token, 'POST', '/posts/' + post.id + '/like', { active: false })
  await call(b.token, 'POST', '/posts/' + post.id + '/like', { active: false })
  assert.equal(
    ((await call('', 'GET', '/posts/' + post.id)).data as ForumPost).likeCount,
    0,
  )
  await call(b.token, 'POST', '/posts/' + post.id + '/favorite', {
    active: true,
  })
  assert.equal(
    ((await call(b.token, 'GET', '/me/favorites')).data as Page<ForumPost>)
      .total,
    1,
  )
  await call(b.token, 'POST', '/posts/' + post.id + '/favorite', {
    active: false,
  })
  assert.equal(
    ((await call(b.token, 'GET', '/me/favorites')).data as Page<ForumPost>)
      .total,
    0,
  )
  const report = (
    await call(b.token, 'POST', '/reports', {
      targetType: 'comment',
      targetId: nested.id,
      reason: 'Please review',
    })
  ).data as ForumReport
  await rejected(
    () =>
      callA('POST', '/reports/' + report.id, {
        status: 'resolved',
        resolution: 'Fake close',
      }),
    403,
  )
  await call(c.token, 'POST', '/reports/' + report.id, {
    status: 'resolved',
    resolution: 'Reviewed and explained',
  })
  assert.ok(
    (
      (await call(b.token, 'GET', '/me/notifications'))
        .data as Page<ForumNotification>
    ).items.some((n) => n.message.includes('举报已处理')),
  )
  await call(c.token, 'POST', '/posts/' + post.id + '/moderate', {
    action: 'lock',
    value: true,
    reason: 'Pause discussion',
  })
  advance(6000)
  await rejected(
    () =>
      call(b.token, 'POST', '/posts/' + post.id + '/comments', {
        body: 'Should fail',
      }),
    409,
  )
  await rejected(
    () => callA('POST', '/posts/' + post.id + '/update', data),
    409,
  )
  await call(c.token, 'POST', '/posts/' + post.id + '/moderate', {
    action: 'lock',
    value: false,
    reason: 'Resume discussion',
  })
  await call(c.token, 'POST', '/restrictions', {
    studentId: b.member.studentId,
    posts: true,
    comments: true,
    postsUntil: null,
    commentsUntil: null,
    reason: 'Violation test',
  })
  await rejected(() => call(b.token, 'POST', '/posts', data), 403)
  await rejected(
    () =>
      call(b.token, 'POST', '/posts/' + post.id + '/comments', {
        body: 'Blocked',
      }),
    403,
  )
  await call(c.token, 'POST', '/restrictions', {
    studentId: b.member.studentId,
    posts: false,
    comments: false,
    postsUntil: null,
    commentsUntil: null,
    reason: 'Restriction lifted',
  })
  advance(31000)
  const pending = (
    await callA('POST', '/posts', { ...data, boardId: board.id })
  ).data as ForumPost
  assert.equal(pending.status, 'pending')
  await rejected(() => call('', 'GET', '/posts/' + pending.id), 404)
  await call(c.token, 'POST', '/posts/' + pending.id + '/moderate', {
    action: 'approve',
    reason: 'Approved',
    value: true,
  })
  await call(c.token, 'POST', '/posts/' + post.id + '/moderate', {
    action: 'hide',
    reason: 'Review required',
    value: true,
  })
  await rejected(() => call('', 'GET', '/posts/' + post.id), 404)
  const revised = (
    await callA('POST', '/posts/' + post.id + '/update', {
      ...data,
      imageIds: [image.id],
    })
  ).data as ForumPost
  assert.equal(
    revised.status,
    'pending',
    'Authors cannot undo moderation by editing',
  )
  await call(c.token, 'POST', '/posts/' + post.id + '/moderate', {
    action: 'approve',
    reason: 'Revision reviewed',
    value: true,
  })
  advance(31000)
  const third = (
    await callA('POST', '/posts', {
      ...data,
      title: 'SQL pagination unique sample',
    })
  ).data as ForumPost
  advance(6000)
  await rejected(
    () =>
      call(b.token, 'POST', '/posts/' + third.id + '/comments', {
        body: 'Cross thread',
        parentId: comment.id,
      }),
    400,
  )
  const paged = (
    await call('', 'GET', '/posts', {}, { page: '1', pageSize: '1' })
  ).data as Page<ForumPost>
  assert.equal(paged.items.length, 1)
  assert.ok(paged.total >= 3)
  const search = (
    await call('', 'GET', '/posts', {}, { search: 'unique sample' })
  ).data as Page<ForumPost>
  assert.equal(search.total, 1)
  const injection = (
    await call(
      '',
      'GET',
      '/posts',
      {},
      { search: "' OR 1=1; DROP TABLE users; --" },
    )
  ).data as Page<ForumPost>
  assert.equal(injection.total, 0)
  const firstPage = (
    await call(
      '',
      'GET',
      '/posts/' + post.id + '/comments',
      {},
      { pageSize: '1' },
    )
  ).data as Page<ForumComment>
  assert.equal(firstPage.items[0]!.floor, 1)
  assert.equal(firstPage.total, 2)
  await call(c.token, 'POST', '/comments/' + nested.id + '/moderate', {
    status: 'hidden',
    reason: 'Comment review',
  })
  assert.equal(
    (
      (await call('', 'GET', '/posts/' + post.id + '/comments'))
        .data as Page<ForumComment>
    ).total,
    1,
  )
  await call(c.token, 'POST', '/comments/' + nested.id + '/moderate', {
    status: 'published',
    reason: 'Comment restored',
  })
  await call(b.token, 'POST', '/comments/' + comment.id + '/delete')
  await rejected(
    () =>
      call(c.token, 'POST', '/comments/' + comment.id + '/moderate', {
        status: 'published',
        reason: 'Must not resurrect deleted content',
      }),
    409,
  )
  const tombstones = (await call('', 'GET', '/posts/' + post.id + '/comments'))
    .data as Page<ForumComment>
  assert.equal(tombstones.items[0]!.body, '该评论已删除')
  assert.ok(!JSON.stringify(tombstones.items[0]).includes('First reply'))
  await root('POST', '/boards/board-1', { name: '综合交流', status: 'hidden' })
  assert.equal(
    ((await call('', 'GET', '/posts')).data as Page<ForumPost>).items.some(
      (p) => p.id === post.id,
    ),
    false,
  )
  await rejected(() => call('', 'GET', '/images/' + image.id), 404)
  await root('POST', '/boards/board-1', { name: '综合交流', status: 'active' })
  const audit = (await call(c.token, 'GET', '/admin/audit')).data as Page<{
    action: string
  }>
  assert.ok(audit.total > 0)
  assert.ok(audit.items.every((a) => a.action.startsWith('forum.')))
  const detailed = (
    await call(c.token, 'GET', '/admin/audit', {}, { pageSize: '30' })
  ).data as Page<{ action: string; details?: { reason?: string } }>
  assert.ok(
    detailed.items.some(
      (row) => row.action === 'forum.users.restrict' && row.details?.reason,
    ),
  )
  const boardRole = (
    await service.execute(
      rootToken,
      'POST',
      '/api/roles',
      {
        name: 'Board-only audit',
        description: 'No restriction/report details',
        permissionIds: ['forum.boards.manage'],
      },
      {},
    )
  ).data as Role
  await service.execute(
    rootToken,
    'PUT',
    '/api/members/' + b.member.uid + '/roles',
    { roleIds: [boardRole.id] },
    {},
  )
  b.token = (
    await service.login(
      { studentId: b.member.studentId, password: 'ForumTest123' },
      'board-auditor',
    )
  ).token!
  const filtered = (
    await call(b.token, 'GET', '/admin/audit', {}, { pageSize: '30' })
  ).data as Page<{ action: string; details?: unknown }>
  assert.ok(
    filtered.items
      .filter((row) => row.action === 'forum.users.restrict')
      .every((row) => row.details === undefined),
  )
  await rejected(() => call(b.token, 'GET', '/admin/reports'), 403)
  await callA('POST', '/posts/' + post.id + '/delete')
  await rejected(() => call('', 'GET', '/posts/' + post.id), 404)
  await rejected(() => call('', 'GET', '/images/' + image.id), 404)
  assert.ok(
    await store.read('forum_comments', nested.id),
    'Soft deletion preserves parent rows and replies',
  )
  for (const invalid of [
    'data:image/svg+xml;base64,' +
      Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
    'data:image/jpeg;base64,' + png.toString('base64'),
    'data:image/png;base64,' +
      Buffer.concat([png, Buffer.from('MZ executable')]).toString('base64'),
    'data:image/png;base64,' + Buffer.alloc(40000).toString('base64'),
  ])
    await rejected(() => root('POST', '/images', { dataUrl: invalid }))
  advance(6000)
  await Promise.all([
    callA('POST', '/posts/' + third.id + '/comments', { body: 'Concurrent A' }),
    call(b.token, 'POST', '/posts/' + third.id + '/comments', {
      body: 'Concurrent B',
    }),
  ])
  const concurrent = (await call('', 'GET', '/posts/' + third.id + '/comments'))
    .data as Page<ForumComment>
  assert.deepEqual(
    concurrent.items.map((c) => c.floor),
    [1, 2],
  )
  const before = await store.read('forum_posts', third.id)
  await rejected(() =>
    store.run(async (tx) => {
      await tx.set('forum_posts', third.id, { ...third, title: 'Rollback' })
      throw new Error('ROLLBACK_FIXTURE')
    }),
  )
  assert.deepEqual(await store.read('forum_posts', third.id), before)
}
