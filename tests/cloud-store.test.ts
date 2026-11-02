import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CloudStore,
  createDatabase,
} from '../apps/functions/src/members/cloud-store'

test('CloudBase adapter uses current snapshot transaction API, strips _id and returns committed result', async () => {
  const calls: string[] = []
  const ref = { collection: 'users', id: 'u1' }
  const transaction = {
    get: async (value: unknown) => {
      assert.deepEqual(value, ref)
      calls.push('get')
      return { data: () => ({ _id: 'u1', uid: 'u1' }) }
    },
    set: async () => {
      calls.push('set')
    },
    delete: async () => {
      calls.push('delete')
    },
    commit: async () => {
      calls.push('commit')
    },
    rollback: async () => {
      calls.push('rollback')
    },
  }
  const db = {
    startTransaction: async () => transaction,
    collection: (name: string) => ({
      doc: (id: string) => ({ collection: name, id }),
    }),
  }
  const store = new CloudStore(
    db as unknown as ReturnType<typeof createDatabase>,
  )
  const result = await store.run(async (tx) => {
    const user = await tx.get<{ uid: string }>('users', 'u1')
    assert.deepEqual(user, { uid: 'u1' })
    await tx.set('users', 'u1', user!)
    await tx.remove('users', 'u1')
    return 42
  })
  assert.equal(result, 42)
  assert.deepEqual(calls, ['get', 'set', 'delete', 'commit'])
})
test('CloudBase adapter rolls back business errors without silently retrying or logging payloads', async () => {
  let starts = 0,
    rollbacks = 0
  const store = new CloudStore({
    startTransaction: async () => {
      starts++
      return {
        rollback: async () => {
          rollbacks++
        },
      }
    },
  } as unknown as ReturnType<typeof createDatabase>)
  await assert.rejects(
    () =>
      store.run(async () => {
        throw new Error('business rejection')
      }),
    /business rejection/,
  )
  assert.equal(starts, 1)
  assert.equal(rollbacks, 1)
})
test('CloudBase search escapes regexp metacharacters', async () => {
  let captured: unknown
  const query = {
    count: async () => ({ total: 0 }),
    orderBy: () => query,
    skip: () => query,
    limit: () => query,
    get: async () => ({ data: [] }),
  }
  const db = {
    command: { neq: (value: string) => value },
    RegExp: (value: unknown) => {
      captured = value
      return value
    },
    collection: () => ({ where: () => query }),
  }
  await new CloudStore(db as unknown as ReturnType<typeof createDatabase>).list(
    'users',
    { _search: '.*' },
    { offset: 0, limit: 20 },
  )
  assert.deepEqual(captured, { regexp: '\\.\\*', options: 'i' })
})
