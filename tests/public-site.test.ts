import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { MemberService } from '../apps/functions/src/members/service'
import type { Store, Transaction, ListOptions } from '../apps/functions/src/members/store'
import { createHandler } from '../apps/functions/src/index'
import { publicSiteSuite } from './helpers/public-site-suite'
import { budgetEstimate, readPublicSite, PUBLIC_SITE_KEY, fetchPublicSite, fetchPublicAsset } from '@electronic-club/shared/public-site'
import { proxyApi } from '../deploy/edgeone/proxy'
import { QiniuPublicSiteStorage } from '../apps/functions/src/public-site-storage'
import { PublicSitePublisher, changesPublicContent } from '../apps/functions/src/public-site-publisher'
import { TestResourceProvider } from './helpers/resources-suite'
import { testPng } from './helpers/forum-suite'
import { randomUUID } from 'node:crypto'
import { encryptTimed, decryptTimed } from '../apps/functions/src/public-site-timed'

class MeasuredStore implements Store {
  calls = 0
  constructor(private inner: Store) {}
  async run<T>(fn: (tx: Transaction) => Promise<T>) { this.calls++; return this.inner.run(fn) }
  async read<T>(c: string, id: string) { this.calls++; return this.inner.read<T>(c, id) }
  async list<T>(c: string, f: Record<string, unknown>, o: ListOptions) { this.calls++; return this.inner.list<T>(c, f, o) }
}
test('public object delivery: privacy, no database reads, failure isolation, recovery and concurrent publication', async () => {
  const oldMode = process.env.PUBLIC_SITE_MODE, oldOrigin = process.env.PUBLIC_SITE_ORIGIN, oldFetch = globalThis.fetch
  try {
    delete process.env.PUBLIC_SITE_MODE
    const store = new MeasuredStore(new MemoryStore()), seed = new MemberService(store)
    await seed.bootstrap({ studentId: '00PUBLIC1', name: 'Private identity', nickname: 'Public nickname' }, 'Public-Test123')
    const token = (await seed.login({ studentId: '00PUBLIC1', password: 'Public-Test123' }, 'local')).token!
    const fixture = await publicSiteSuite(store, token), { service, storage, article, post, image, resourceId } = fixture
    process.env.PUBLIC_SITE_MODE = 'qiniu'
    process.env.PUBLIC_SITE_ORIGIN = storage.origin()
    const paths = ['/public/events', '/public/articles', `/public/articles/${article.id}`, '/public/popup', '/forum/boards', '/forum/posts',
      `/forum/posts/${post.id}`, `/forum/posts/${post.id}/comments`, '/resources', `/resources/${resourceId}/download`, `/media/${image.id}`]
    store.calls = 0
    for (let i = 0; i < 500; i++) await service.execute('', 'GET', '/api' + paths[i % paths.length], {}, {})
    assert.equal(store.calls, 0, '500 public reads, pagination, detail, download and image must not wake SQL')
    await assert.rejects(service.execute('', 'GET', `/api/public/articles/${fixture.draft.id}`, {}, {}), /公开|不存在/)
    await assert.rejects(service.execute('', 'GET', `/api/media/${fixture.staged.id}`, {}, {}), /公开|不存在/)
    await assert.rejects(service.execute('', 'GET', '/api/public/articles', {}, { live: 'true' }), /登录/)
    await assert.rejects(service.execute('', 'GET', '/api/resources', {}, { status: 'draft' }), /参数/)
    await assert.rejects(service.execute('', 'GET', '/api/forum/boards', {}, { admin: 'true' }), /登录/)
    await assert.rejects(service.execute('', 'GET', '/api/public/unknown', {}, {}), /不存在/)
    storage.failRead = true
    await assert.rejects(service.execute('', 'GET', '/api/public/articles', {}, {}), /公开内容/)
    storage.failRead = false
    assert.equal(store.calls, 0, 'missing/private content and outages must not fall back to SQL')
    const snapshot = (await storage.read())!
    assert.equal((readPublicSite(snapshot, '/api/forum/posts', { search: "' OR 1=1 --" }).data as { total: number }).total, 0)
    assert.throws(() => readPublicSite(snapshot, '/api/forum/posts', { page: '-1' }), /分页/)
    const calls: string[] = []
    globalThis.fetch = async (url, options) => {
      calls.push(String(url))
      assert.equal(new Headers(options?.headers).get('cookie'), null)
      assert.equal(new Headers(options?.headers).get('authorization'), null)
      return new Response(JSON.stringify(snapshot))
    }
    const handler = createHandler(() => { throw Error('database service factory must not run') })
    assert.equal((await handler({ path: '/api/public/articles', httpMethod: 'GET' })).statusCode, 200)
    const edge = await proxyApi({ request: new Request('https://club.test/api/forum/posts', { headers: { cookie: '__Host-ec-session=private' } }), env: { PUBLIC_SITE_ORIGIN: storage.origin() } }, globalThis.fetch)
    assert.equal(edge.status, 200)
    assert.equal(edge.headers.get('x-eclub-public-delivery'), 'qiniu-v1')
    assert.ok(calls.every((url) => url.startsWith(storage.origin() + '/')))
    const failedEdge = await proxyApi({ request: new Request('https://club.test/api/public/articles'), env: { PUBLIC_SITE_ORIGIN: storage.origin() } }, async () => new Response('offline', { status: 503 }))
    assert.equal(failedEdge.status, 503)
    const stamp = Date.now()
    await service.execute(token, 'POST', '/api/popups', { title: 'Earlier public announcement', summary: 'test', targetType: 'article', targetId: article.id,
      startsAt: new Date(stamp - 1000).toISOString(), expiresAt: new Date(stamp + 600000).toISOString(), priority: 1 }, {})
    const future = (await service.execute(token, 'POST', '/api/popups', { title: 'FUTURE_ANNOUNCEMENT_SECRET', summary: 'Scheduled only', targetType: 'article', targetId: article.id,
      image: 'media:' + fixture.staged.id, startsAt: new Date(stamp + 120000).toISOString(), expiresAt: new Date(stamp + 240000).toISOString(), priority: 100 }, {})).data as { id: string }
    assert.ok(!JSON.stringify(await storage.read()).includes('FUTURE_ANNOUNCEMENT_SECRET'))
    store.calls = 0
    assert.notEqual((await service.execute('', 'GET', '/api/public/popup', {}, {})).data && ((await service.execute('', 'GET', '/api/public/popup', {}, {})).data as { id: string }).id, future.id)
    await assert.rejects(service.execute('', 'GET', '/api/media/' + fixture.staged.id, {}, {}), /公开|不存在/)
    fixture.advance(60_000)
    assert.equal(((await service.execute('', 'GET', '/api/public/popup', {}, {})).data as { id: string }).id, future.id)
    assert.deepEqual((await service.execute('', 'GET', '/api/media/' + fixture.staged.id, {}, {})).binary, testPng())
    fixture.advance(140_000)
    assert.equal((await service.execute('', 'GET', '/api/public/popup', {}, {})).data, null, 'Superseded announcement must not reappear after newer one expires')
    assert.equal(store.calls, 0, 'Scheduled announcements and gated images must not wake SQL at their release time')
    storage.failPut = true
    const failed = await service.execute(token, 'POST', `/api/articles/${article.id}/update`, { title: 'Saved despite storage outage' }, {})
    assert.equal(failed.publicSync, 'failed')
    assert.equal((await store.read<{ title: string }>('articles', article.id))!.title, 'Saved despite storage outage')
    storage.failPut = false
    assert.equal((await service.execute(token, 'POST', '/api/public-site/rebuild', {}, {})).publicSync, 'ready')
    let release!: () => void, started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    storage.beforeManifest = async () => { storage.beforeManifest = undefined; started(); await new Promise<void>((resolve) => { release = resolve }) }
    const first = service.execute(token, 'POST', `/api/articles/${article.id}/update`, { title: 'Concurrent first' }, {})
    await waiting
    const second = await service.execute(token, 'POST', `/api/articles/${article.id}/update`, { title: 'Concurrent latest' }, {})
    assert.equal(second.publicSync, 'pending')
    release()
    await first
    assert.equal((await storage.read())!.articles.find((v) => v.id === article.id)!.title, 'Concurrent latest')
    const removedKey = (await storage.read())!.assets['/api/media/' + image.id]!.key
    storage.failDelete = true
    await service.execute(token, 'POST', `/api/articles/${article.id}/update`, { content: 'Image removed' }, {})
    assert.equal((await storage.read())!.assets['/api/media/' + image.id], undefined)
    storage.failDelete = false
    await service.execute(token, 'POST', '/api/public-site/rebuild', {}, {})
    assert.equal(storage.objects.has(removedKey), false)
    // Revoke visibility of a board and all its posts/comments in the same new public version.
    await service.execute(token, 'POST', `/api/forum/boards/${fixture.board.id}`, { name: 'Hidden', description: 'test', position: 999, status: 'hidden', requireReview: false }, {})
    assert.ok(!(await storage.read())!.posts.some((v) => v.id === post.id))
  } finally {
    globalThis.fetch = oldFetch
    if (oldMode === undefined) delete process.env.PUBLIC_SITE_MODE; else process.env.PUBLIC_SITE_MODE = oldMode
    if (oldOrigin === undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN = oldOrigin
  }
})

test('1500-point budget requires an explicit shared-instance price and counts active windows, not requests', () => {
  assert.equal(budgetEstimate(null, 20, 20).withinTarget, null)
  // Sensitivity example only: 0.095 is an input, NOT an asserted CloudBase shared tariff.
  assert.equal(budgetEstimate(0.095, 20, 20).estimated, 1440)
  assert.equal(budgetEstimate(0.095, 20, 20).withinTarget, true)
  assert.equal(budgetEstimate(0.095, 20, 30).withinTarget, false)
  assert.equal(budgetEstimate(0.095, 20, 1).windows, 20)
  assert.throws(() => budgetEstimate(0, 20, 20), /PRICE/)
  assert.throws(() => budgetEstimate(0.095, 32, 20), /BUDGET/)
  for (const path of ['/api/auth/password','/api/imports/process','/api/forum/posts/id/favorite','/api/forum/posts/id/view','/api/forum/reports','/api/media/id/complete','/api/events/id/checkin','/api/members/id/roles'])
    assert.equal(changesPublicContent(path), false)
  for (const path of ['/api/articles/id/update','/api/events/id/registration','/api/events/id/manual-checkin','/api/forum/posts/id/comments','/api/forum/boards/id','/api/profile','/api/members/id/anonymize'])
    assert.equal(changesPublicContent(path), true)
})

test('image copying resumes across time budgets and lease recovery; progress rows stay below gateway limits', async () => {
  const store = new MemoryStore(), seed = new MemberService(store)
  await seed.bootstrap({ studentId: '00RESUME1', name: 'Test' }, 'Resume-Test123')
  const token = (await seed.login({ studentId: '00RESUME1', password: 'Resume-Test123' }, 'local')).token!
  const fixture = await publicSiteSuite(store, token)
  const ids = Array.from({ length: 20 }, () => randomUUID())
  await store.run(async (tx) => {
    for (const id of ids) await tx.set('media_images', id, { id, ownerUid: fixture.article.publisherUid, status: 'ready', mime: 'image/png', bytes: testPng().length,
      chunkCount: 1, createdAt: new Date().toISOString(), bindings: [{ kind: 'articles', id: fixture.article.id }] })
  })
  let now = Date.now()
  const storage = fixture.storage
  const originalPut = storage.put.bind(storage)
  storage.put = async (key, bytes) => { if (key !== PUBLIC_SITE_KEY) now += 6000; return originalPut(key, bytes) }
  const publisher = new PublicSitePublisher(store, async () => ({ binary: testPng(), contentType: 'image/png' }), storage, new TestResourceProvider(), () => now)
  assert.equal(await publisher.sync(), 'pending')
  let result: string = 'pending'
  for (let attempt = 0; attempt < 6 && result !== 'ready'; attempt++) result = await publisher.sync()
  assert.equal(result, 'ready')
  const snapshot = (await storage.read())!
  for (const id of ids) {
    assert.ok(snapshot.assets['/api/media/' + id])
    const row = await store.read('system', 'public-site:asset:/api/media/' + id)
    assert.ok(Buffer.byteLength(JSON.stringify(row)) < 2048)
  }
  const state = (await store.read<object>('system', 'public-site:publisher'))!
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 2048)
  await store.run((tx) => tx.set('system', 'public-site:publisher', { ...state, owner: 'crashed-owner', until: now - 1, dirty: true }))
  assert.equal(await publisher.sync(), 'ready')
})

test('Qiniu publication writes only its namespace using exact object-scoped overwrite tokens; public reads carry no keys', async () => {
  const names = ['QINIU_ACCESS_KEY','QINIU_SECRET_KEY','QINIU_BUCKET','QINIU_DOWNLOAD_DOMAIN','PUBLIC_SITE_ORIGIN','QINIU_UPLOAD_URL']
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]))
  try {
    Object.assign(process.env, { QINIU_ACCESS_KEY: 'test-ak', QINIU_SECRET_KEY: 'test-sk', QINIU_BUCKET: 'test-bucket',
      QINIU_DOWNLOAD_DOMAIN: 'https://files.test', PUBLIC_SITE_ORIGIN: 'https://origin.test' })
    delete process.env.QINIU_UPLOAD_URL
    const store = new QiniuPublicSiteStorage(async (_url, options) => {
      const form = options!.body as FormData, token = String(form.get('token')).split(':')
      const decoded = JSON.parse(Buffer.from(token[2]!, 'base64url').toString())
      assert.equal(decoded.scope, 'test-bucket:' + String(form.get('key')))
      assert.equal(decoded.insertOnly, 0)
      const signature = createHmac('sha1', 'test-sk').update(token[2]!).digest('base64url')
      assert.equal(token[1]!.replace(/=+$/, ''), signature)
      return new Response(JSON.stringify({ key: String(form.get('key')) }))
    })
    await store.put(PUBLIC_SITE_KEY, new Uint8Array([1,2,3]), 'application/json')
    const timed = { popups: [], retired: ['FUTURE_PRIVATE_STATE'], assets: {} }
    const encrypted = encryptTimed(timed)
    assert.ok(!encrypted.includes(Buffer.from('FUTURE_PRIVATE_STATE')))
    assert.deepEqual(decryptTimed(encrypted), timed)
    const tampered = Buffer.from(encrypted); tampered[tampered.length - 1]! ^= 1
    assert.throws(() => decryptTimed(tampered))
    await store.putTimed(timed)
    await assert.rejects(store.put('electronicclub/resources/v1/existing.pdf', new Uint8Array([1]), 'application/pdf'), /KEY/)
    await assert.rejects(store.remove(PUBLIC_SITE_KEY), /FORBIDDEN/)
    await assert.rejects(fetchPublicSite('https://origin.test', async () => new Response('x', { headers: { 'content-length': '9000000' } })), /SIZE/)
    await assert.rejects(fetchPublicAsset('https://origin.test', { key: '../private', mime: 'text/html', bytes: 1 }), /FORMAT/)
  } finally {
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] }
  }
})
