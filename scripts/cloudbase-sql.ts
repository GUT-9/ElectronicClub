import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
export interface Migration {
  Version: string
  Name: string
  Query: string
}
interface Database {
  previewPGUserMigrations(options: {
    EnvId: string
    Migrations: Migration[]
  }): Promise<{
    Executable?: boolean
    Conflicts?: unknown[]
    Pending?: unknown[]
    Applied?: unknown[]
  }>
  pushPGUserMigrations(options: {
    EnvId: string
    Migrations: Migration[]
    LockTimeoutMs: number
    StatementTimeoutMs: number
  }): Promise<{ TaskId: string }>
  describeTaskResult(options: {
    EnvId: string
    TaskId: string
  }): Promise<{ Status?: string }>
  executePGSql(options: { EnvId: string; Sql: string }): Promise<unknown>
}
export async function migrations(
  options: { managed?: boolean } = {},
): Promise<Migration[]> {
  const result: Migration[] = []
  for (const [Version, Name, file] of [
    ['20261102000100', 'electronicclub_schema', '001-schema.sql'],
    ['20261102000200', 'electronicclub_indexes', '002-indexes.sql'],
    options.managed
      ? [
          '20261103000200',
          'electronicclub_managed_rpc',
          '006-managed-service-role.sql',
        ]
      : ['20261103000100', 'electronicclub_http_rpc', '004-http-rpc.sql'],
  ]) {
    const original = await readFile(`cloudbase/sql/${file}`, 'utf8')
    // This official migration API consumes full SQL files. Do not nest explicit BEGIN/COMMIT.
    const Query = original
      .replace(/^BEGIN;\s*/, '')
      .replace(/\s*COMMIT;\s*$/, '')
    result.push({ Version: Version!, Name: Name!, Query })
  }
  return result
}
export async function deploy(
  db: Database,
  env: string,
  items: Migration[],
  apply = false,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
) {
  const preview = await db.previewPGUserMigrations({
    EnvId: env,
    Migrations: items,
  })
  if (!apply)
    return {
      mode: 'preview',
      executable: preview.Executable === true,
      pending: preview.Pending?.length ?? 0,
      conflicts: preview.Conflicts?.length ?? 0,
    }
  if (!preview.Executable || preview.Conflicts?.length)
    throw new Error('MIGRATION_CONFLICT_OR_UNSUPPORTED')
  if (!preview.Pending?.length)
    return { mode: 'apply', status: 'already_applied' }
  const task = await db.pushPGUserMigrations({
    EnvId: env,
    Migrations: items,
    LockTimeoutMs: 5000,
    StatementTimeoutMs: 30000,
  })
  if (!task.TaskId) throw new Error('MISSING_TASK_ID')
  for (let i = 0; i < 60; i++) {
    const status = await db.describeTaskResult({
      EnvId: env,
      TaskId: task.TaskId,
    })
    if (status.Status === 'Succeed')
      return { mode: 'apply', status: 'succeeded', taskId: task.TaskId }
    if (status.Status === 'Failed') throw new Error('MIGRATION_TASK_FAILED')
    await wait(2000)
  }
  throw new Error('MIGRATION_TIMEOUT_CHECK_TASK_BEFORE_RETRY')
}
async function main() {
  const items = await migrations({
    managed: process.argv.includes('--managed'),
  })
  if (process.argv.includes('--plan')) {
    console.log(
      JSON.stringify(
        items.map((m) => ({
          version: m.Version,
          name: m.Name,
          sha256: createHash('sha256').update(m.Query).digest('hex'),
        })),
        null,
        2,
      ),
    )
    return
  }
  const env = process.env.CLOUDBASE_ENV_ID
  if (!env) throw new Error('ENV_REQUIRED')
  const apply = process.argv.includes('--apply')
  if (apply && !process.argv.includes(`--confirm-env=${env}`))
    throw new Error('EXPLICIT_ENV_CONFIRMATION_REQUIRED')
  const require = createRequire(import.meta.url)
  const sdk = require(
    process.env.CLOUDBASE_MANAGER_PATH ?? '@cloudbase/manager-node',
  )
  const Manager = sdk.default ?? sdk
  const db: Database = new Manager({
    envId: env,
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN,
  }).database
  if (
    process.argv.includes('--probe') ||
    process.argv.includes('--probe-batch')
  ) {
    await db.executePGSql({
      EnvId: env,
      Sql: process.argv.includes('--probe-batch')
        ? 'BEGIN; SELECT 1 AS connection_check; ROLLBACK;'
        : 'SELECT 1 AS connection_check',
    })
    console.log(
      'Management SQL API reachable; this does NOT prove function TCP connectivity',
    )
    return
  }
  console.log(JSON.stringify(await deploy(db, env, items, apply)))
}
if (process.argv[1]?.endsWith('cloudbase-sql.ts'))
  main().catch(() => {
    console.error(
      'CloudBase management operation failed. No SQL, credentials or raw SDK error logged. Check IAM, package capability, remote task and console.',
    )
    process.exitCode = 1
  })
