// Private offline SQL generator, never imported by index.main. Not a runtime database fallback.
import { writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { MemberService } from './members/service'
import type { Store, Transaction } from './members/store'
export async function generateBootstrapSql(input: unknown, password: string) {
  const records = new Map<
    string,
    { collection: string; id: string; data: object }
  >()
  const store: Store = {
    read: async () => null,
    list: async () => {
      throw new Error('NOT_SUPPORTED')
    },
    run: async <T>(fn: (tx: Transaction) => Promise<T>) =>
      fn({
        get: async <R>(c: string, id: string) =>
          (records.get(c + '/' + id)?.data ?? null) as R | null,
        set: async (c, id, data) => {
          records.set(c + '/' + id, { collection: c, id, data })
        },
        remove: async () => {
          throw new Error('NOT_SUPPORTED')
        },
      }),
  }
  await new MemberService(store).bootstrap(input, password)
  const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'"
  let sql =
    "BEGIN;\nSET LOCAL standard_conforming_strings=on;\nSELECT pg_advisory_xact_lock(1991,1);\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM electronicclub.system WHERE id='control') THEN RAISE EXCEPTION 'ALREADY_INITIALIZED'; END IF; END $$;\n"
  for (const { collection, id, data } of records.values())
    sql += `INSERT INTO electronicclub.${collection}(id,data) VALUES(${literal(id)},${literal(JSON.stringify(data))}::jsonb);\n`
  for (const { collection, id, data } of records.values())
    if (collection === 'users')
      for (const role of (data as { roleIds: string[] }).roleIds)
        sql += `INSERT INTO electronicclub.user_roles(user_id,role_id) VALUES(${literal(id)},${literal(role)});\n`
  return sql + 'COMMIT;\n'
}
async function main() {
  const output = process.argv
    .find((arg) => arg.startsWith('--output='))
    ?.slice(9)
  if (
    !output ||
    !isAbsolute(output) ||
    resolve(output).startsWith(resolve(process.cwd()) + sep) ||
    !process.env.BOOTSTRAP_PASSWORD ||
    !process.env.BOOTSTRAP_STUDENT_ID ||
    !process.env.BOOTSTRAP_NAME
  )
    throw new Error('PRIVATE_CONFIGURATION_REQUIRED')
  const sql = await generateBootstrapSql(
    {
      studentId: process.env.BOOTSTRAP_STUDENT_ID,
      name: process.env.BOOTSTRAP_NAME,
      nickname: process.env.BOOTSTRAP_NICKNAME || undefined,
    },
    process.env.BOOTSTRAP_PASSWORD,
  )
  await writeFile(output, sql, { mode: 0o600, flag: 'wx' })
  console.log(
    'Private initialization SQL created. Contains sensitive hashes; do not upload to GitHub or the public function ZIP.',
  )
}
if (
  process.argv[1]?.endsWith('offline-bootstrap.ts') ||
  process.argv[1]?.endsWith('offline-bootstrap.js')
)
  main().catch(() => {
    console.error('Offline initialization plan failed; no credentials logged.')
    process.exitCode = 1
  })
