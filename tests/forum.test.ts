import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { forumSuite, testPng } from './helpers/forum-suite'
import { inspectImage } from '../apps/functions/src/forum/images'
import { createHandler } from '../apps/functions/src/index'
test('forum business integration: ownership, moderation, replies, reactions, pagination, restrictions, images and notifications', async () => {
  let now = Date.now()
  const store = new MemoryStore(),
    service = new MemberService(store, () => now)
  await service.bootstrap(
    { studentId: '00FORUMROOT', name: 'Local forum test' },
    'ForumRoot123',
  )
  const token = (
    await service.login(
      { studentId: '00FORUMROOT', password: 'ForumRoot123' },
      'root',
    )
  ).token!
  await forumSuite(service, store, token, (ms) => (now += ms))
  const handler = createHandler(() => service)
  assert.equal(
    (await handler({ path: '/api/forum/me/posts', httpMethod: 'GET' }))
      .statusCode,
    401,
  )
  assert.equal(
    (await handler({ path: '/api/forum/boards', httpMethod: 'GET' }))
      .statusCode,
    200,
  )
})
test('forum image validator rejects executable text and invalid PNG CRC', () => {
  const image = testPng()
  assert.equal(
    inspectImage('data:image/png;base64,' + image.toString('base64')).bytes,
    image.length,
  )
  const invalid = Buffer.from(image)
  invalid[40] = invalid[40]! ^ 1
  assert.throws(() =>
    inspectImage('data:image/png;base64,' + invalid.toString('base64')),
  )
  assert.throws(() =>
    inspectImage(
      'data:image/jpeg;base64,' +
        Buffer.from('MZ executable data and HTML script').toString('base64'),
    ),
  )
})
test('forum image budget is atomic and abandoned staging cleanup is bounded and audited', async () => {
  const { changeImageStorage, cleanupStagedImages, IMAGE_STORAGE_KEY } =
    await import('../apps/functions/src/forum/storage')
  const store = new MemoryStore()
  const old = process.env.FORUM_IMAGE_BUDGET_BYTES
  process.env.FORUM_IMAGE_BUDGET_BYTES = '1024'
  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        store.run((tx) => changeImageStorage(tx, 256)),
      ),
    )
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 4)
    assert.equal(
      (await store.read<{ bytes: number }>('system', IMAGE_STORAGE_KEY))!.bytes,
      1024,
    )
    await store.run((tx) =>
      tx.set('forum_images', 'cleanup-fixture', {
        id: 'cleanup-fixture',
        ownerUid: 'local',
        status: 'staged',
        postId: null,
        dataUrl: 'A'.repeat(100),
        createdAt: new Date(Date.now() - 172800000).toISOString(),
      }),
    )
    const result = await cleanupStagedImages(store, Date.now(), 1)
    assert.equal(result.removed, 1)
    assert.equal(await store.read('forum_images', 'cleanup-fixture'), null)
    assert.equal(
      (await store.read<{ bytes: number }>('system', IMAGE_STORAGE_KEY))!.bytes,
      924,
    )
    assert.equal(
      (
        await store.list(
          'audit_logs',
          { _forumAudit: true },
          { offset: 0, limit: 20 },
        )
      ).total,
      1,
    )
  } finally {
    if (old === undefined) delete process.env.FORUM_IMAGE_BUDGET_BYTES
    else process.env.FORUM_IMAGE_BUDGET_BYTES = old
  }
})
test('forum HTTP: guest reads, CSRF, authenticated Base64 uploads, binary images and 64KiB budget', async () => {
  const { DEFAULT_FORUM_BOARDS } = await import('../packages/shared/src/index')
  const { sessionCookieConfig } =
    await import('../apps/functions/src/members/cookie')
  const store = new MemoryStore(),
    service = new MemberService(store)
  await service.bootstrap(
    { studentId: '00FORUMHTTP', name: 'Local HTTP test' },
    'ForumHttp123',
  )
  const token = (
    await service.login(
      { studentId: '00FORUMHTTP', password: 'ForumHttp123' },
      'http',
    )
  ).token!
  for (const board of DEFAULT_FORUM_BOARDS)
    await store.run((tx) =>
      tx.set('forum_boards', board.id, {
        ...board,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    )
  const handler = createHandler(() => service),
    previous = process.env.ALLOWED_ORIGIN
  process.env.ALLOWED_ORIGIN = 'https://forum-test.example'
  const headers = {
    origin: 'https://forum-test.example',
    'content-type': 'application/json',
    'x-requested-with': 'ElectronicClub',
    cookie: sessionCookieConfig().name + '=' + token,
  }
  try {
    assert.equal(
      (
        await handler({
          path: '/api/forum/boards',
          httpMethod: 'GET',
          queryStringParameters: { admin: 'true' },
        })
      ).statusCode,
      401,
    )
    const upload = {
      path: '/api/forum/images',
      httpMethod: 'POST',
      headers,
      body: JSON.stringify({
        dataUrl: 'data:image/png;base64,' + testPng().toString('base64'),
      }),
    }
    assert.equal(
      (
        await handler({
          ...upload,
          headers: { ...headers, origin: 'https://other.example' },
        })
      ).statusCode,
      403,
    )
    assert.equal(
      (await handler({ ...upload, headers: { ...headers, cookie: '' } }))
        .statusCode,
      401,
    )
    assert.equal(
      (await handler({ ...upload, body: 'A'.repeat(65537) })).statusCode,
      413,
    )
    const imageResponse = await handler({
      ...upload,
      isBase64Encoded: true,
      body: Buffer.from(upload.body).toString('base64'),
    })
    assert.equal(imageResponse.statusCode, 200, imageResponse.body)
    const image = JSON.parse(imageResponse.body).data
    const post = await handler({
      path: '/api/forum/posts',
      httpMethod: 'POST',
      headers,
      body: JSON.stringify({
        title: 'HTTP test',
        body: 'Safe content',
        boardId: 'board-1',
        imageIds: [image.id],
      }),
    })
    assert.equal(post.statusCode, 200, post.body)
    const binary = await handler({
      path: '/api/forum/images/' + image.id,
      httpMethod: 'GET',
    })
    assert.equal(binary.statusCode, 200, binary.body)
    assert.equal(binary.headers['Content-Type'], 'image/png')
    assert.equal(binary.isBase64Encoded, true)
    assert.deepEqual(Buffer.from(binary.body, 'base64'), testPng())
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGIN
    else process.env.ALLOWED_ORIGIN = previous
  }
})
