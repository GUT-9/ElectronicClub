import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PublicReadCache, publicReadKey } from '../apps/functions/src/public-read-cache'
import { MemberService } from '../apps/functions/src/members/service'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { HttpStore } from '../apps/functions/src/members/http-store'
import type { Transaction } from '../apps/functions/src/members/store'
import type { ClubArticle, Identity } from '@electronic-club/shared'
import { digest } from '../apps/functions/src/members/crypto'

class MeasuredStore extends MemoryStore {
  runs = 0
  writes: string[] = []
  override async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.runs++
    return super.run((tx) => work({
      ...tx,
      set: async (c, id, value) => {
        this.writes.push(c + '/' + id)
        return tx.set(c, id, value)
      },
    }))
  }
}

test('public response cache coalesces concurrent misses, expires, clones and rejects stale in-flight refill', async () => {
  let now = 0, calls = 0
  const cache = new PublicReadCache<{ value: number }>(() => now, 2, 1024)
  const load = async () => ({ value: ++calls })
  const values = await Promise.all(Array.from({ length: 20 }, () => cache.load('a', 60, load)))
  assert.equal(calls, 1)
  values[0]!.value = 999
  assert.equal((await cache.load('a', 60, load)).value, 1)
  now = 60
  assert.equal((await cache.load('a', 60, load)).value, 2)
  await cache.load('b', 60, load)
  await cache.load('c', 60, load)
  assert.equal((await cache.load('a', 60, load)).value, 5)
  let finish!: (value: { value: number }) => void
  const slow = cache.load('slow', 60, () => new Promise((resolve) => { finish = resolve }))
  await Promise.resolve()
  cache.clear()
  assert.equal((await cache.load('slow', 60, load)).value, 6)
  finish({ value: 999 })
  await slow
  assert.equal((await cache.load('slow', 60, load)).value, 6)
  await assert.rejects(cache.load('failure', 60, async () => { throw Error('offline') }))
  assert.equal((await cache.load('failure', 60, load)).value, 7)
  const large = new PublicReadCache<string>(() => now, 1, 8)
  let largeLoads = 0
  for (let i = 0; i < 2; i++) await large.load('x', 60, async () => { largeLoads++; return 'too large' })
  assert.equal(largeLoads, 2)
})

test('cache allowlist excludes identity, permissions, moderation, scheduled popups, media and signed downloads', () => {
  for (const path of ['/api/auth/me', '/api/members', '/api/roles', '/api/forum/posts',
    '/api/forum/boards', '/api/public/popup', '/api/media/abc', '/api/resources/config',
    '/api/resources/abc/download']) assert.equal(publicReadKey('GET', path, {}), null)
  const privateQueries: Record<string, string>[] = [{ admin: 'true' }, { status: 'draft' }, { unexpected: 'x' }]
  for (const query of privateQueries)
    assert.equal(publicReadKey('GET', '/api/resources', query), null)
  assert.equal(publicReadKey('POST', '/api/public/events', {}), null)
  assert.equal(publicReadKey('GET', '/api/public/events', { search: 'x'.repeat(2000) }), null)
  assert.equal(publicReadKey('GET', '/api/public/articles', { page: '1', search: '电子' }),
    publicReadKey('GET', '/api/public/articles', { search: '电子', page: '1' }))
})

test('public lists avoid repeated database work, mutations invalidate, other instances expire, private reads remain live', async () => {
  let now = Date.now()
  const store = new MeasuredStore(), service = new MemberService(store, () => now)
  await service.bootstrap({ studentId: '00CACHE1', name: 'Test' }, 'Cache-Test123')
  const token = (await service.login({ studentId: '00CACHE1', password: 'Cache-Test123' }, 'local')).token!
  const article = (await service.execute(token, 'POST', '/api/articles', {
    title: 'Initial article', content: 'Public body', status: 'published',
  }, {})).data as ClubArticle
  const list = () => service.execute('', 'GET', '/api/public/articles', {}, {})
  store.runs = 0
  await Promise.all(Array.from({ length: 20 }, list))
  assert.equal(store.runs, 1)
  await list()
  assert.equal(store.runs, 1)
  const otherInstance = new MemberService(store, () => now)
  await otherInstance.execute('', 'GET', '/api/public/articles', {}, {})
  await service.execute(token, 'POST', `/api/articles/${article.id}/update`, { title: 'Updated article' }, {})
  assert.equal(((await list()).data as { items: ClubArticle[] }).items[0]!.title, 'Updated article')
  assert.equal(((await otherInstance.execute('', 'GET', '/api/public/articles', {}, {})).data as { items: ClubArticle[] }).items[0]!.title, 'Initial article')
  now += 60_000
  assert.equal(((await otherInstance.execute('', 'GET', '/api/public/articles', {}, {})).data as { items: ClubArticle[] }).items[0]!.title, 'Updated article')
  store.writes = []
  const before = await store.read('system', 'control')
  for (let i = 0; i < 10; i++) await service.execute(token, 'GET', '/api/auth/me', {}, {})
  assert.deepEqual(await store.read('system', 'control'), before)
  assert.equal(store.writes.filter((key) => key === 'system/control').length, 0)
  assert.equal(store.writes.filter((key) => key.startsWith('sessions/')).length, 1)
  store.writes = []
  // Public popup reads still execute in real time but a stable selection is not rewritten.
  await service.execute('', 'GET', '/api/public/popup', {}, {})
  store.writes = []
  await service.execute('', 'GET', '/api/public/popup', {}, {})
  assert.deepEqual(store.writes, [])
  const identity = (await service.execute(token, 'GET', '/api/auth/me', {}, {})).data as Identity
  await store.run(async (tx) => {
    const user = await tx.get<Identity['member']>('users', identity.member.uid)
    await tx.set('users', user!.uid, { ...user!, status: 'disabled' })
  })
  await assert.rejects(service.execute(token, 'GET', '/api/auth/me', {}, {}), /会话已失效/)
})

test('session idle renewal is bounded and expired sessions cannot be revived', async () => {
  let now = Date.now()
  const store = new MeasuredStore(), service = new MemberService(store, () => now)
  await service.bootstrap({ studentId: '00IDLE1', name: 'Test' }, 'Idle-Test123')
  const token = (await service.login({ studentId: '00IDLE1', password: 'Idle-Test123' }, 'local')).token!
  store.writes = []
  const me = () => service.execute(token, 'GET', '/api/auth/me', {}, {})
  await me()
  now += 59_999
  await me()
  assert.equal(store.writes.length, 0)
  now++
  await me()
  assert.deepEqual(store.writes, ['sessions/' + digest(token)])
  now += 30 * 60_000
  await assert.rejects(me(), /会话已失效/)
})

test('HTTP empty transactions avoid commit; row snapshots still validate and retry conflicts even without writes', async () => {
  const calls: string[] = []
  let value = 1, conflict = true
  const store = new HttpStore(async (name, args) => {
    calls.push(name)
    if (name === 'ec_read') return { data: { value }, etag: String(value) }
    assert.equal(name, 'ec_commit')
    assert.deepEqual(args.p_writes, [])
    if (conflict) { conflict = false; value = 2; return { ok: false, conflict: true } }
    return { ok: true }
  })
  assert.equal(await store.run(async () => 'empty'), 'empty')
  assert.deepEqual(calls, [])
  assert.equal(await store.run(async (tx) => {
    const [a, b] = await Promise.all([
      tx.get<{ value: number }>('roles', 'test'), tx.get<{ value: number }>('roles', 'test'),
    ])
    a!.value = 999
    return b!.value
  }), 2)
  assert.deepEqual(calls, ['ec_read', 'ec_commit', 'ec_read', 'ec_commit'])
})
