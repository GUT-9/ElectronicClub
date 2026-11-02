// Private deployment CLI. Not exported by the HTTP bundle.
import { MemberService } from './members/service'
import { CloudStore, createDatabase } from './members/cloud-store'
const collections = [
  'users',
  'roles',
  'permissions',
  'audit_logs',
  'import_jobs',
  'credentials',
  'sessions',
  'student_ids',
  'login_limits',
  'system',
  'privacy_jobs',
]
async function run() {
  if (process.argv.includes('--collections')) {
    const db = createDatabase()
    for (const name of collections) {
      await db.createCollection(name)
      console.log(`Created collection: ${name}`)
    }
    return
  }
  if (!process.argv.includes('--initialize'))
    throw new Error('Explicit --initialize or --collections required')
  if (
    !process.env.BOOTSTRAP_STUDENT_ID ||
    !process.env.BOOTSTRAP_NAME ||
    !process.env.BOOTSTRAP_PASSWORD
  )
    throw new Error(
      'Set BOOTSTRAP_STUDENT_ID, BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD securely',
    )
  const user = await new MemberService(new CloudStore()).bootstrap(
    {
      studentId: process.env.BOOTSTRAP_STUDENT_ID,
      name: process.env.BOOTSTRAP_NAME,
      nickname: process.env.BOOTSTRAP_NICKNAME || undefined,
    },
    process.env.BOOTSTRAP_PASSWORD,
  )
  console.log(`Initialization completed. UID: ${user.uid}`)
}
run().catch(() => {
  console.error(
    'Initialization failed; verify configuration, collection state, credentials and one-time initialization status. No secrets logged.',
  )
  process.exitCode = 1
})
