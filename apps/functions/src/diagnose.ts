import { HttpStore } from './members/http-store'
// Private deployment check. Never registered as an HTTP route.
import { createPool, DatabaseFailure } from './members/pg-store'
async function run() {
  if (process.env.DB_DRIVER !== 'postgres-tcp') {
    const store = new HttpStore()
    await store.run(async (tx) => {
      await tx.get('system', 'control')
    })
    console.log(
      JSON.stringify({
        httpsRpc: true,
        transactionRoundtrip: true,
        initialized: !!(await store.read('system', 'control')),
      }),
    )
    return
  }
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
run().catch((error) => {
  console.error(
    JSON.stringify({
      ...(error instanceof DatabaseFailure ? error.diagnostic : undefined),
      stage:
        error instanceof DatabaseFailure ? error.stage : 'database_diagnostic',
      code:
        error instanceof DatabaseFailure ? error.safeCode : 'DB_CHECK_FAILED',
    }),
  )
  process.exitCode = 1
})
