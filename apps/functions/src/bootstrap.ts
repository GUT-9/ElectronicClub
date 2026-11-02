// Private deployment CLI. Not exported by the HTTP bundle.
import { MemberService } from './members/service'
import { PgStore as CloudStore, createPool } from './members/pg-store'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
async function run() {
  if (process.argv.includes('--migrate')) {
    const pool = createPool()
    try {
      for (const file of ['001-schema.sql', '002-indexes.sql'])
        await pool.query(
          await readFile(
            resolve(process.env.SQL_DIR ?? '../../cloudbase/sql', file),
            'utf8',
          ),
        )
    } finally {
      await pool.end()
    }
    return
  }
  if (!process.argv.includes('--initialize'))
    throw new Error('Explicit --initialize or --migrate required')
  if (
    !process.env.BOOTSTRAP_STUDENT_ID ||
    !process.env.BOOTSTRAP_NAME ||
    !process.env.BOOTSTRAP_PASSWORD
  )
    throw new Error(
      'Set BOOTSTRAP_STUDENT_ID, BOOTSTRAP_NAME, BOOTSTRAP_PASSWORD securely',
    )
  const store = new CloudStore()
  try {
    if (await store.read('system', 'control')) {
      console.log('Already initialized; no changes made')
      return
    }
    try {
      const user = await new MemberService(store).bootstrap(
        {
          studentId: process.env.BOOTSTRAP_STUDENT_ID,
          name: process.env.BOOTSTRAP_NAME,
          nickname: process.env.BOOTSTRAP_NICKNAME || undefined,
        },
        process.env.BOOTSTRAP_PASSWORD,
      )
      console.log(`Initialization completed. UID: ${user.uid}`)
    } catch (error) {
      if ((error as { code?: string }).code === 'ALREADY_INITIALIZED') {
        console.log('Already initialized; no changes made')
        return
      }
      throw error
    }
  } finally {
    await store.pool.end()
  }
}
run().catch(() => {
  console.error(
    'Private initialization failed; inspect configuration and safe database diagnostics. No credentials logged.',
  )
  process.exitCode = 1
})
