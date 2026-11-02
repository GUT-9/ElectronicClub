// Private privacy/retention CLI; never exported by the HTTP entry point.
import { CloudStore } from './members/cloud-store'
import { digest, studentIdKey } from './members/crypto'
import type { ImportJob } from '@electronic-club/shared'
async function main() {
  const store = new CloudStore(),
    uid = process.argv[2]
  if (!uid) throw new Error('Pass anonymized member UID')
  const privacy = await store.read<{
    uid: string
    studentIdDigest: string
    status: string
  }>('privacy_jobs', uid)
  if (!privacy) throw new Error('No pending privacy job')
  let page = 0
  for (;;) {
    const result = await store.list<ImportJob>(
      'import_jobs',
      {},
      { offset: page * 100, limit: 100 },
    )
    for (const job of result.items) {
      if (
        !job.rows.some(
          (row) =>
            row.uid === uid ||
            (row.member &&
              (studentIdKey(row.member.studentId) === privacy.studentIdDigest ||
                digest(row.member.studentId) === privacy.studentIdDigest)),
        )
      )
        continue
      await store.run(async (tx) => {
        const control = await tx.get<{ revision: number }>('system', 'control')
        if (!control) throw new Error('Not initialized')
        control.revision++
        await tx.set('system', 'control', control)
        const current = await tx.get<ImportJob>('import_jobs', job.id)
        if (!current) return
        for (const row of current.rows)
          if (
            row.uid === uid ||
            (row.member &&
              (studentIdKey(row.member.studentId) === privacy.studentIdDigest ||
                digest(row.member.studentId) === privacy.studentIdDigest))
          ) {
            delete row.member
            delete row.uid
            row.error = '个人资料已按隐私请求清理'
          }
        await tx.set('import_jobs', job.id, current)
      })
    }
    if ((page + 1) * 100 >= result.total) break
    page++
  }
  await store.run(async (tx) => {
    await tx.set('privacy_jobs', uid, {
      ...privacy,
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
  })
  console.log(
    'Privacy job completed; original user profile is already anonymized. Backups and external exports follow their own retention policy.',
  )
}
main().catch(() => {
  console.error(
    'Privacy cleanup failed; verify UID, permissions and configuration. Retry is safe.',
  )
  process.exitCode = 1
})
