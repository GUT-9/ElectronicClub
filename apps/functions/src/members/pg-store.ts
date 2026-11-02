import { Pool } from 'pg'
import type { Store, Transaction, ListOptions } from './store'
const tables = new Set([
  'users',
  'roles',
  'permissions',
  'credentials',
  'sessions',
  'student_ids',
  'audit_logs',
  'import_jobs',
  'login_limits',
  'system',
  'privacy_jobs',
])
function table(name: string) {
  if (!tables.has(name)) throw new Error('INVALID_TABLE')
  return `electronicclub.${name}`
}
export class DatabaseFailure extends Error {
  constructor(
    public stage: string,
    public safeCode: string,
  ) {
    super('Database unavailable')
  }
}
export function createPool() {
  if (!process.env.DATABASE_URL)
    throw new DatabaseFailure('configuration', 'DATABASE_NOT_CONFIGURED')
  if (process.env.PG_TLS !== 'disable' && !process.env.PG_CA_CERT)
    throw new DatabaseFailure('configuration', 'TLS_CA_REQUIRED')
  let endpoint: URL
  try {
    endpoint = new URL(process.env.DATABASE_URL)
  } catch {
    throw new DatabaseFailure('configuration', 'INVALID_DATABASE_URL')
  }
  if (
    !['postgres:', 'postgresql:'].includes(endpoint.protocol) ||
    [...endpoint.searchParams.keys()].some((key) =>
      key.toLowerCase().startsWith('ssl'),
    )
  )
    throw new DatabaseFailure('configuration', 'UNSAFE_DATABASE_URL')
  if (
    process.env.PG_TLS === 'disable' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
  )
    throw new DatabaseFailure('configuration', 'REMOTE_TLS_REQUIRED')
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    ssl:
      process.env.PG_TLS === 'disable'
        ? false
        : { rejectUnauthorized: true, ca: process.env.PG_CA_CERT },
  })
}
export class PgStore implements Store {
  constructor(public pool = createPool()) {
    pool.on('error', () =>
      console.error(
        JSON.stringify({
          category: 'database',
          stage: 'idle_connection',
          code: 'DB_CONNECTION_FAILED',
        }),
      ),
    )
  }
  private roleVerified = false
  private async verifyRole() {
    if (this.roleVerified) return
    const result = await this.pool
      .query(
        'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=current_user',
      )
      .catch(() => {
        throw new DatabaseFailure('authorization', 'DB_ROLE_CHECK_FAILED')
      })
    if (!result.rows[0] || Object.values(result.rows[0]).some(Boolean))
      throw new DatabaseFailure('authorization', 'PRIVILEGED_DB_ROLE')
    this.roleVerified = true
  }
  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    await this.verifyRole()
    const client = await this.pool.connect().catch(() => {
      throw new DatabaseFailure('connect', 'DB_CONNECT_FAILED')
    })
    let stage = 'begin'
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'")
      await client.query('SELECT pg_advisory_xact_lock(1991,1)')
      stage = 'transaction'
      const tx: Transaction = {
        get: async <T>(c: string, id: string) => {
          const result = await client.query(
            `SELECT data FROM ${table(c)} WHERE id=$1`,
            [id],
          )
          return (result.rows[0]?.data ?? null) as T | null
        },
        set: async (c, id, value) => {
          await client.query(
            `INSERT INTO ${table(c)}(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
            [id, JSON.stringify(value)],
          )
          if (c === 'users') {
            await client.query(
              'DELETE FROM electronicclub.user_roles WHERE user_id=$1',
              [id],
            )
            for (const role of (value as { roleIds?: string[] }).roleIds ?? [])
              await client.query(
                'INSERT INTO electronicclub.user_roles VALUES($1,$2)',
                [id, role],
              )
          }
        },
        remove: async (c, id) => {
          await client.query(`DELETE FROM ${table(c)} WHERE id=$1`, [id])
        },
      }
      const result = await fn(tx)
      stage = 'commit'
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* original failure preserved */
      }
      const code = String((error as { code?: string }).code ?? '')
      if (/^[0-9A-Z]{5}$/.test(code)) throw new DatabaseFailure(stage, code)
      throw error
    } finally {
      client.release()
    }
  }
  async read<T>(c: string, id: string): Promise<T | null> {
    try {
      await this.verifyRole()
      return (
        (
          await this.pool.query(`SELECT data FROM ${table(c)} WHERE id=$1`, [
            id,
          ])
        ).rows[0]?.data ?? null
      )
    } catch {
      throw new DatabaseFailure('read', 'DB_READ_FAILED')
    }
  }
  async list<T>(
    c: string,
    filter: Record<string, unknown>,
    options: ListOptions,
  ) {
    await this.verifyRole()
    const args: unknown[] = [],
      clauses: string[] = []
    const param = (value: unknown) => {
      args.push(value)
      return `$${args.length}`
    }
    for (const [key, value] of Object.entries(filter)) {
      if (key === '_search')
        clauses.push(
          `(strpos(upper(data->>'studentId'),upper(${param(value)}))>0 OR strpos(upper(data->>'name'),upper($${args.length}))>0 OR strpos(upper(data->>'nickname'),upper($${args.length}))>0)`,
        )
      else if (key === '_notDeleted') clauses.push("data->>'status'<>'deleted'")
      else if (key === 'roleIds')
        clauses.push(
          `data->'roleIds' @> ${param(JSON.stringify([value]))}::jsonb`,
        )
      else {
        if (!['status', 'college', 'className', 'owner', 'uid'].includes(key))
          throw new Error('INVALID_FILTER')
        clauses.push(`data->>'${key}'=${param(value)}`)
      }
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
    try {
      const count = await this.pool.query(
        `SELECT count(*) AS total FROM ${table(c)}${where}`,
        args,
      )
      const rows = await this.pool.query(
        `SELECT data FROM ${table(c)}${where} ORDER BY data->>'createdAt' DESC,id ASC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, options.limit, options.offset],
      )
      return {
        items: rows.rows.map((row) => row.data) as T[],
        total: Number(count.rows[0].total),
      }
    } catch {
      throw new DatabaseFailure('query', 'DB_QUERY_FAILED')
    }
  }
}
