import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'
const command = process.argv[2],
  target = process.env.PGDATABASE ?? 'electronicclub'
if (!/^(electronicclub|postgres|eclub_restore_[0-9_]+)$/.test(target))
  throw Error('Invalid target database')
const pool = new Pool({
  host: '/var/run/postgresql',
  user: 'postgres',
  database: target,
  password: (await readFile('/run/secrets/db_password', 'utf8')).trim(),
  max: 1,
})
const q = (s, args) => pool.query(s, args)
async function grants() {
  await q(
    'REVOKE ALL ON SCHEMA electronicclub FROM PUBLIC,anon,authenticated; GRANT USAGE ON SCHEMA electronicclub TO service_role; REVOKE ALL ON ALL TABLES IN SCHEMA electronicclub FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA electronicclub TO service_role; REVOKE ALL ON electronicclub.schema_migrations,electronicclub.deployment_migrations FROM service_role; REVOKE CREATE ON SCHEMA public FROM PUBLIC',
  )
  const functions = await q(
    "SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='electronicclub' OR n.nspname='public' AND p.proname LIKE 'ec\\_%'",
  )
  for (const f of functions.rows)
    await q(
      `REVOKE ALL ON FUNCTION ${f.name} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${f.name} TO service_role`,
    )
}
async function verify() {
  const exists = await q("SELECT to_regclass('electronicclub.users') AS users")
  if (!exists.rows[0].users) throw Error('Missing application schema')
  const mismatches = await q(
    "SELECT count(*)::int AS n FROM electronicclub.roles r WHERE (r.data->>'memberCount')::int<>(SELECT count(*) FROM electronicclub.user_roles ur WHERE ur.role_id=r.id)",
  )
  if (mismatches.rows[0].n)
    throw Error('Role counts do not match member assignments')
  const n = (await q('SELECT count(*)::int AS n FROM electronicclub.users'))
    .rows[0].n
  if (n) {
    const result = await q(
      "SELECT count(*)::int AS n FROM electronicclub.users u WHERE u.data->>'status'='active' AND EXISTS(SELECT 1 FROM electronicclub.user_roles ur JOIN electronicclub.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.data->>'super'='true')",
    )
    if (!result.rows[0].n) throw Error('No active super administrator')
  }
}
try {
  if (command === 'migrate') {
    const password = (
      await readFile('/run/secrets/app_password', 'utf8')
    ).trim()
    if (!/^[a-f0-9]{64}$/.test(password))
      throw Error('Invalid application password file')
    for (const name of ['service_role', 'anon', 'authenticated']) {
      const old = await q(
        'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',
        [name],
      )
      if (!old.rowCount)
        await q(
          `CREATE ROLE ${name} ${name === 'service_role' ? `LOGIN PASSWORD '${password}'` : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
        )
      else if (Object.values(old.rows[0]).some(Boolean))
        throw Error('Privileged application role refused')
    }
    await q('SELECT pg_advisory_lock(1991,1)')
    try {
      await q(
        'CREATE SCHEMA IF NOT EXISTS electronicclub; CREATE TABLE IF NOT EXISTS electronicclub.deployment_migrations(file text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
      )
      const plan = JSON.parse(
        await readFile('/app/sql/migrations.json', 'utf8'),
      )
      const known = (
        await q('SELECT file,sha256 FROM electronicclub.deployment_migrations')
      ).rows
      if (known.some((row) => !plan.includes(row.file)))
        throw Error('Database is newer than this release; downgrade refused')
      for (const file of plan) {
        if (!/^[a-z0-9-]+\.sql$/.test(file))
          throw Error('Invalid migration name')
        const sql = await readFile('/app/sql/' + file, 'utf8'),
          hash = createHash('sha256').update(sql).digest('hex'),
          old = known.find((row) => row.file === file)
        if (old) {
          if (old.sha256 !== hash)
            throw Error('Historical migration changed: ' + file)
          continue
        }
        await q(sql)
        await q(
          'INSERT INTO electronicclub.deployment_migrations(file,sha256) VALUES($1,$2)',
          [file, hash],
        )
      }
      await grants()
      await verify()
      console.log(
        'Schema verified; existing accounts and passwords were preserved',
      )
    } finally {
      await q('SELECT pg_advisory_unlock(1991,1)')
    }
  } else if (command === 'verify') {
    await verify()
    console.log('Restored database verified')
  } else if (command === 'swap') {
    const stage = process.argv[3],
      previous = process.argv[4]
    if (
      target !== 'postgres' ||
      !/^eclub_restore_[0-9_]+$/.test(stage) ||
      !/^eclub_previous_[0-9_]+$/.test(previous)
    )
      throw Error('Invalid restore names')
    await q(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('electronicclub',$1) AND pid<>pg_backend_pid()",
      [stage],
    )
    await q('BEGIN')
    try {
      await q(`ALTER DATABASE electronicclub RENAME TO "${previous}"`)
      await q(`ALTER DATABASE "${stage}" RENAME TO electronicclub`)
      await q('COMMIT')
    } catch (e) {
      await q('ROLLBACK')
      throw e
    }
    console.log('Database switched; previous database retained as ' + previous)
  } else throw Error('Unknown admin command')
} catch (error) {
  console.error('Administration failed: ' + error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
