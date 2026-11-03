import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ClubEvent, ClubArticle } from '../../packages/shared/src/index'
import type { MemberService } from '../../apps/functions/src/members/service'
import type { Store } from '../../apps/functions/src/members/store'

export async function contentIdentitySuite(service: MemberService, store: Store, token: string) {
  const call = (method: string, path: string, body: unknown = {}) =>
    service.execute(token, method, '/api' + path, body, {})
  const eventBody = {
    title: 'Identity regression fixture',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 172800000).toISOString(),
    status: 'published', registrationEnabled: true,
    registrationDeadline: new Date(Date.now() + 3600000).toISOString(),
  }
  const original = (await call('POST', '/events', eventBody)).data as ClubEvent
  const untouched = (await call('POST', '/events', eventBody)).data as ClubEvent
  await call('POST', `/events/${original.id}/registration`)
  const enrolled = await store.read<ClubEvent>('events', original.id)
  // Simulate legacy/manual JSON inconsistency without changing primary keys or FKs.
  await store.run(async (tx) => tx.set('events', original.id, { ...enrolled!, id: untouched.id }))
  const read = (await call('GET', `/events/${original.id}`)).data as ClubEvent
  assert.equal(read.id, original.id)
  for (const path of ['/events', '/public/events']) {
    const items = ((await call('GET', path)).data as { items: ClubEvent[] }).items
    assert.ok(items.some((v) => v.id === original.id))
    assert.equal(items.filter((v) => v.id === untouched.id).length, 1)
  }
  const cover = 'data:image/jpeg;base64,/9j/2Q=='
  const updated = (await call('POST', `/events/${original.id}/update`, { cover })).data as ClubEvent
  assert.equal(updated.id, original.id)
  assert.equal((await store.read<ClubEvent>('events', original.id))!.cover, cover)
  assert.equal((await store.read<ClubEvent>('events', original.id))!.id, original.id)
  assert.deepEqual(updated.registrationIds, enrolled!.registrationIds)
  assert.deepEqual(await store.read<ClubEvent>('events', untouched.id), untouched)
  await store.run(async (tx) => tx.set('events', original.id, { ...updated, id: randomUUID() }))
  await call('PATCH', `/events/${original.id}`, { summary: 'Updated original key' })
  assert.equal((await store.read<ClubEvent>('events', original.id))!.id, original.id)

  const article = (await call('POST', '/articles', { title: 'Original article', content: 'Test content', status: 'published' })).data as ClubArticle
  const otherArticle = (await call('POST', '/articles', { title: 'Untouched article', content: 'Untouched content', status: 'published' })).data as ClubArticle
  await store.run(async (tx) => tx.set('articles', article.id, { ...article, id: otherArticle.id }))
  assert.equal(((await call('GET', `/public/articles/${article.id}`)).data as ClubArticle).id, article.id)
  const savedArticle = (await call('POST', `/articles/${article.id}/update`, { cover })).data as ClubArticle
  assert.equal(savedArticle.id, article.id)
  assert.equal((await store.read<ClubArticle>('articles', article.id))!.cover, cover)
  assert.deepEqual(await store.read<ClubArticle>('articles', otherArticle.id), otherArticle)
}
