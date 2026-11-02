// Private deployment check. Never registered as an HTTP route.
import { createPool } from './members/pg-store'
async function run() {
  const pool = createPool()
  try {
    const connection = await pool.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT 1')
      await connection.query('ROLLBACK')
      const role = await connection.query(
        'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=current_user',
      )
      const unsafe = Object.values(role.rows[0] ?? {}).some(Boolean)
      if (unsafe) throw new Error('PRIVILEGED_ROLE')
      console.log(
        JSON.stringify({
          database: 'reachable',
          transaction: 'passed',
          restrictedRole: true,
        }),
      )
    } finally {
      connection.release()
    }
  } finally {
    await pool.end()
  }
}
run().catch(() => {
  console.error(
    JSON.stringify({ stage: 'database_diagnostic', code: 'DB_CHECK_FAILED' }),
  )
  process.exitCode = 1
})
