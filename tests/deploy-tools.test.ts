import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrations, deploy } from '../scripts/cloudbase-sql'
test('management plan contains schema/indexes/RPCs without outer transactions', async () => {
  const items = await migrations()
  assert.equal(items.length, 3)
  for (const m of items) {
    assert.match(m.Version, /^\d{14}$/)
    assert.ok(!m.Query.startsWith('BEGIN;'))
    assert.ok(!m.Query.includes('GRANT USAGE'))
  }
})
test('management apply refuses conflicts, skips applied migrations and waits for task success', async () => {
  let pushes = 0
  const db = {
    previewPGUserMigrations: async () => ({ Executable: true, Pending: [{}] }),
    pushPGUserMigrations: async () => {
      pushes++
      return { TaskId: 'test' }
    },
    describeTaskResult: async () => ({ Status: 'Succeed' }),
    executePGSql: async () => ({}),
  }
  assert.equal((await deploy(db, 'test', await migrations())).mode, 'preview')
  assert.equal(pushes, 0)
  assert.equal(
    (await deploy(db, 'test', await migrations(), true, async () => {})).status,
    'succeeded',
  )
  db.previewPGUserMigrations = async () => ({ Executable: false, Pending: [] })
  await assert.rejects(() => deploy(db, 'test', [], true))
  assert.equal(pushes, 1)
  db.previewPGUserMigrations = async () => ({ Executable: true, Pending: [] })
  assert.equal((await deploy(db, 'test', [], true)).status, 'already_applied')
})

test('managed migration plan uses existing provider role and leaves legacy migration unchanged', async () => {
  const managed = await migrations({ managed: true }),
    legacy = await migrations()
  assert.deepEqual(managed.slice(0, 2), legacy.slice(0, 2))
  assert.equal(legacy[2]!.Name, 'electronicclub_http_rpc')
  assert.equal(managed[2]!.Name, 'electronicclub_managed_rpc')
  assert.ok(managed[2]!.Query.includes("current_user <> 'service_role'"))
  assert.ok(!managed[2]!.Query.includes('electronicclub_api'))
})
