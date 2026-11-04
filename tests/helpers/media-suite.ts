import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import {
  bodyMedia,
  MAX_MEDIA_IMAGE_BYTES,
  MEDIA_CHUNK_BYTES,
  permissionGroup,
} from '../../packages/shared/src/index'
import type {
  Member,
  Role,
  ClubArticle,
  ClubEvent,
  ForumBoard,
  ForumPostView,
  Page,
  Permission,
} from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'
import { testPng } from './forum-suite'
import { cleanupMedia } from '../../apps/functions/src/media/storage'
// Valid PNG with a large ancillary text chunk, exercising all three transport chunks.
export function largePng() {
  const base = testPng(),
    payload = Buffer.alloc(49 * 1024, 65),
    name = Buffer.from('tEXt'),
    body = Buffer.concat([name, payload])
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let n = 0; n < 8; n++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  const chunk = Buffer.alloc(payload.length + 12)
  chunk.writeUInt32BE(payload.length)
  body.copy(chunk, 4)
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return Buffer.concat([base.subarray(0, -12), chunk, base.subarray(-12)])
}
export async function mediaSuite(
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
  const upload = async (token: string, bytes: Buffer = testPng()) => {
    const image = (
      await call(token, 'POST', '/media', {
        mime: 'image/png',
        bytes: bytes.length,
      })
    ).data as { id: string; chunkCount: number }
    for (let n = 0; n < image.chunkCount; n++)
      await call(token, 'POST', `/media/${image.id}/chunks/${n}`, {
        data: bytes
          .subarray(n * MEDIA_CHUNK_BYTES, (n + 1) * MEDIA_CHUNK_BYTES)
          .toString('base64'),
      })
    await call(token, 'POST', `/media/${image.id}/complete`)
    return image.id
  }
  const source = largePng()
  assert.ok(
    source.length > MEDIA_CHUNK_BYTES * 2 &&
      source.length <= MAX_MEDIA_IMAGE_BYTES,
  )
  const image = await upload(root, source)
  await assert.rejects(() => call('', 'GET', '/media/' + image), /公开|不存在/)
  assert.deepEqual((await call(root, 'GET', '/media/' + image)).binary, source)
  await assert.rejects(
    () => call(root, 'POST', `/media/${image}/chunks/0`, { data: 'AA==' }),
    /完成/,
  )
  await assert.rejects(() =>
    call(root, 'POST', '/media', { mime: 'image/svg+xml', bytes: 30 }),
  )
  await assert.rejects(() =>
    call(root, 'POST', '/media', {
      mime: 'image/png',
      bytes: MAX_MEDIA_IMAGE_BYTES + 1,
    }),
  )
  const pending = (
    await call(root, 'POST', '/media', { mime: 'image/png', bytes: 100 })
  ).data as { id: string }
  await assert.rejects(
    () => call(root, 'POST', `/media/${pending.id}/complete`),
    /完整/,
  )
  await assert.rejects(
    () => call(root, 'POST', `/media/${pending.id}/chunks/0`, { data: 'AAAA' }),
    /分片/,
  )
  await call(root, 'POST', `/media/${pending.id}/delete`)
  const body = `## 正文图片\n![制作记录](media:${image})\n<script>alert(1)</script>`
  assert.deepEqual(bodyMedia(body), [image])
  const article = (
    await call(root, 'POST', '/articles', {
      title: '正文图片测试新闻',
      content: body,
      cover: 'media:' + image,
      status: 'draft',
    })
  ).data as ClubArticle
  await assert.rejects(() => call('', 'GET', '/media/' + image), /公开|不存在/)
  await call(root, 'POST', `/articles/${article.id}/publish`, { publish: true })
  assert.deepEqual((await call('', 'GET', '/media/' + image)).binary, source)
  const publicReads = await Promise.all(
    Array.from({ length: 12 }, () => call(root, 'GET', '/media/' + image)),
  )
  assert.ok(publicReads.every((r) => r.binary?.equals(source)))
  await assert.rejects(
    () => call(root, 'POST', `/media/${image}/delete`),
    /使用/,
  )
  const event = (
    await call(root, 'POST', '/events', {
      title: '正文图片测试活动',
      content: body,
      cover: 'media:' + image,
      status: 'published',
      startsAt: '2030-01-01T00:00:00Z',
      endsAt: '2030-01-01T02:00:00Z',
    })
  ).data as ClubEvent
  await call(root, 'POST', `/articles/${article.id}/publish`, {
    publish: false,
  })
  assert.deepEqual(
    (await call('', 'GET', '/media/' + image)).binary,
    source,
    'another published binding keeps the image public',
  )
  await call(root, 'POST', `/events/${event.id}/update`, { status: 'draft' })
  await assert.rejects(() => call('', 'GET', '/media/' + image), /公开|不存在/)
  await call(root, 'POST', `/events/${event.id}/update`, {
    content: '去掉图片',
    cover: '',
  })
  await call(root, 'POST', `/articles/${article.id}/update`, {
    content: '去掉图片',
    cover: '',
  })
  await call(root, 'POST', `/media/${image}/delete`)
  assert.equal(await store.read('media_chunks', image + ':0'), null)
  const member = (
    await call(root, 'POST', '/members', {
      studentId: '00MEDIA01',
      name: '图片测试成员',
    })
  ).data as Member
  const initial = await service.login(
    { studentId: member.studentId, password: '123456' },
    'media-test',
  )
  await call(initial.token!, 'POST', '/auth/password', {
    oldPassword: '123456',
    newPassword: 'Media-Test123',
  })
  const token = (
    await service.login(
      { studentId: member.studentId, password: 'Media-Test123' },
      'media-test',
    )
  ).token!
  const memberImage = await upload(token)
  const board = (
    await call(root, 'POST', '/forum/boards', { name: '图片测试版块' })
  ).data as ForumBoard
  await assert.rejects(
    () =>
      call(root, 'POST', '/articles', {
        title: '越权引用图片',
        content: `![非法引用](media:${memberImage})`,
      }),
    /其他成员/,
  )
  const post = (
    await call(token, 'POST', '/forum/posts', {
      title: '图片正文帖子',
      body: `上文\n![电路图](media:${memberImage})\n下文`,
      boardId: board.id,
    })
  ).data as ForumPostView
  assert.deepEqual(
    (await call('', 'GET', '/media/' + memberImage)).binary,
    testPng(),
  )
  await call(root, 'POST', `/forum/posts/${post.id}/moderate`, {
    action: 'hide',
    reason: '测试隐藏内容',
  })
  await assert.rejects(
    () => call('', 'GET', '/media/' + memberImage),
    /公开|不存在/,
  )
  await assert.rejects(
    () => call(root, 'POST', `/media/${memberImage}/delete`),
    /本人/,
  )
  const ids = Array.from({ length: 13 }, () => randomUUID())
  await assert.rejects(
    () =>
      call(root, 'POST', '/articles', {
        title: '图片超出数量',
        content: ids.map((id) => `![图片](media:${id})`).join('\n'),
      }),
    /最多12/,
  )
  const invalid = (
    await call(root, 'POST', '/media', { mime: 'image/png', bytes: 30 })
  ).data as { id: string }
  await call(root, 'POST', `/media/${invalid.id}/chunks/0`, {
    data: Buffer.alloc(30, 65).toString('base64'),
  })
  await assert.rejects(
    () => call(root, 'POST', `/media/${invalid.id}/complete`),
    /格式|内容/,
  )
  await call(root, 'POST', `/media/${invalid.id}/delete`)
  const storageBefore =
    (await store.read<{ bytes: number }>('system', 'forum:image-storage'))
      ?.bytes ?? 0
  const oldBudget = process.env.FORUM_IMAGE_BUDGET_BYTES
  process.env.FORUM_IMAGE_BUDGET_BYTES = String(
    Math.max(1024, storageBefore + 1500),
  )
  try {
    const attempts = await Promise.allSettled([
      call(root, 'POST', '/media', { mime: 'image/png', bytes: 1000 }),
      call(root, 'POST', '/media', { mime: 'image/png', bytes: 1000 }),
    ])
    assert.equal(
      attempts.filter((r) => r.status === 'fulfilled').length,
      1,
      'concurrent uploads cannot exceed the shared storage budget',
    )
    for (const r of attempts)
      if (r.status === 'fulfilled')
        await call(
          root,
          'POST',
          `/media/${(r.value.data as { id: string }).id}/delete`,
        )
    assert.equal(
      (await store.read<{ bytes: number }>('system', 'forum:image-storage'))
        ?.bytes,
      storageBefore,
    )
  } finally {
    if (oldBudget === undefined) delete process.env.FORUM_IMAGE_BUDGET_BYTES
    else process.env.FORUM_IMAGE_BUDGET_BYTES = oldBudget
  }
  const dangling = await upload(root)
  const cleanup = await cleanupMedia(store, Date.now() + 2 * 86400000)
  assert.ok(cleanup.removed >= 1)
  assert.equal(await store.read('media_images', dangling), null)
  const privateImage = await upload(root)
  await call(root, 'POST', '/articles', {
    title: '仅发布权限的私有图片预览',
    content: `![图片](media:${privateImage})`,
    status: 'draft',
  })
  await assert.rejects(
    () => call(token, 'GET', '/media/' + privateImage),
    /公开|不存在/,
  )
  const publisher = (
    await call(root, 'POST', '/roles', {
      name: '媒体文章发布审核',
      description: '验证发布权限可查看草稿图片',
      permissionIds: ['articles.publish'],
    })
  ).data as Role
  await call(root, 'PUT', `/members/${member.uid}/roles`, {
    roleIds: [...member.roleIds, publisher.id],
  })
  const publisherToken = (
    await service.login(
      { studentId: member.studentId, password: 'Media-Test123' },
      'media-test',
    )
  ).token!
  assert.deepEqual(
    (await call(publisherToken, 'GET', '/media/' + privateImage)).binary,
    testPng(),
  )
  const permissions = (await call(root, 'GET', '/permissions'))
    .data as Permission[]
  for (const p of permissions) assert.equal(p.group, permissionGroup(p.id))
  assert.ok(
    !permissions.some((p) => ['第三阶段', '后续业务'].includes(p.group)),
  )
  const search = (
    await service.execute(
      '',
      'GET',
      '/api/forum/posts',
      {},
      { search: "'; DROP TABLE users;--" },
    )
  ).data as Page<ForumPostView>
  assert.equal(search.total, 0)
  return { imageId: memberImage }
}
