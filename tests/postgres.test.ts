import { test } from 'node:test'
import { generateBootstrapSql } from '../apps/functions/src/offline-bootstrap'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { PgStore } from '../apps/functions/src/members/pg-store'
import { MemberService } from '../apps/functions/src/members/service'
import { createHandler } from '../apps/functions/src/index'
import type {
  Identity,
  Member,
  ImportJob,
  Role,
} from '../packages/shared/src/index'
import { templateWorkbook } from '../apps/functions/src/members/xlsx'
import ExcelJS from 'exceljs'
const url = process.env.PG_TEST_URL
test(
  'real PostgreSQL: migrations, constraints, auth, RBAC, import, rollback and concurrency',
  { skip: !url },
  async () => {
    assert.equal(new URL(url!).hostname, '127.0.0.1')
    assert.equal(new URL(url!).pathname, '/club_test')
    const pool = new Pool({ connectionString: url, max: 5 })
    let runtimePool: Pool | undefined
    try {
      await pool.query('DROP SCHEMA IF EXISTS electronicclub CASCADE')
      for (const file of ['001-schema.sql', '002-indexes.sql']) {
        const sql = await readFile(`cloudbase/sql/${file}`, 'utf8')
        await pool.query(sql)
        await pool.query(sql)
      }
      assert.equal(
        (
          await pool.query(
            'SELECT count(*) FROM electronicclub.schema_migrations',
          )
        ).rows[0].count,
        '1',
      )
      await pool.query(
        "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='electronicclub_api') THEN CREATE ROLE electronicclub_api LOGIN PASSWORD 'local-restricted-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$",
      )
      await pool.query(
        await readFile('cloudbase/sql/003-permissions.sql', 'utf8'),
      )
      const restricted = new URL(url!)
      restricted.username = 'electronicclub_api'
      restricted.password = 'local-restricted-test'
      runtimePool = new Pool({ connectionString: restricted.href, max: 4 })
      const store = new PgStore(runtimePool)
      assert.equal(
        (
          await runtimePool.query(
            'SELECT rolsuper FROM pg_roles WHERE rolname=current_user',
          )
        ).rows[0].rolsuper,
        false,
      )
      const offline = await generateBootstrapSql(
        { studentId: '00offline1', name: 'Offline test', nickname: 'TEST' },
        'Offline-Test-Password123',
      )
      assert.ok(!offline.includes('Offline-Test-Password123'))
      await runtimePool.query(offline)
      await assert.rejects(() => runtimePool!.query(offline))
      await runtimePool.query('ROLLBACK')
      // Dedicated local test schema only: reset generated records before ordinary bootstrap coverage.
      await pool.query(
        'TRUNCATE electronicclub.user_roles,electronicclub.credentials,electronicclub.sessions,electronicclub.student_ids,electronicclub.privacy_jobs,electronicclub.users,electronicclub.roles,electronicclub.permissions,electronicclub.audit_logs,electronicclub.import_jobs,electronicclub.login_limits,electronicclub.system CASCADE',
      )
      const service = new MemberService(store),
        password = 'Pg-Validation-Password123'
      const root = await service.bootstrap(
        { studentId: '00root12', name: '数据库测试', nickname: 'TESTER' },
        password,
      )
      await assert.rejects(() =>
        service.bootstrap(
          { studentId: '00root13', name: '不得重建' },
          password,
        ),
      )
      const login = await service.login(
        { studentId: '00root12', password },
        'local',
      )
      assert.ok(login.token)
      assert.equal((login.data as Identity).member.studentId, '00ROOT12')
      assert.equal(
        (
          await service.login(
            { studentId: '00root12', password: 'wrong' },
            'local',
          )
        ).status,
        401,
      )
      const token = login.token!,
        member = (
          await service.execute(
            token,
            'POST',
            '/api/members',
            { studentId: '00ab1234', name: '测试成员' },
            {},
          )
        ).data as Member
      await assert.rejects(() =>
        service.execute(
          token,
          'POST',
          '/api/members',
          { studentId: '00AB1234', name: '重复' },
          {},
        ),
      )
      await assert.rejects(() =>
        pool.query(
          "INSERT INTO electronicclub.users(id,data) VALUES('duplicate',$1)",
          [JSON.stringify({ ...member, uid: 'duplicate' })],
        ),
      )
      await assert.rejects(() =>
        store.run(async (tx) => {
          await tx.set('system', 'rollback-test', { value: 1 })
          throw new Error('rollback')
        }),
      )
      assert.equal(await store.read('system', 'rollback-test'), null)
      assert.equal(
        (
          await store.list<Member>(
            'users',
            { _search: 'ab123', roleIds: 'role_member' },
            { offset: 0, limit: 10 },
          )
        ).total,
        1,
      )
      const initial = await service.login(
        { studentId: '00ab1234', password: '123456' },
        'local',
      )
      await assert.rejects(() =>
        service.execute(initial.token!, 'GET', '/api/members', {}, {}),
      )
      await service.execute(
        initial.token!,
        'POST',
        '/api/auth/password',
        { oldPassword: '123456', newPassword: password },
        {},
      )
      await assert.rejects(() =>
        service.execute(initial.token!, 'GET', '/api/auth/me', {}, {}),
      )
      const userToken = (
        await service.login({ studentId: '00AB1234', password }, 'local')
      ).token!
      await assert.rejects(() =>
        service.execute(
          userToken,
          'PUT',
          `/api/members/${member.uid}/roles`,
          { roleIds: ['role_super'] },
          {},
        ),
      )
      await service.execute(
        token,
        'POST',
        `/api/members/${member.uid}/password`,
        {},
        {},
      )
      await assert.rejects(() =>
        service.execute(userToken, 'GET', '/api/auth/me', {}, {}),
      )
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(
        (await templateWorkbook()) as unknown as ExcelJS.Buffer,
      )
      book.worksheets[0]!.addRow(['00cd5678', '导入测试'])
      const job = (
        await service.prepareImport(token, {
          file: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
        })
      ).data as ImportJob
      const processed = await Promise.all([
        service.execute(
          token,
          'POST',
          `/api/imports/${job.id}/process`,
          { offset: 0 },
          {},
        ),
        service.execute(
          token,
          'POST',
          `/api/imports/${job.id}/process`,
          { offset: 0 },
          {},
        ),
      ])
      assert.ok(
        processed.every((result) => (result.data as ImportJob).created === 1),
      )
      const results = await Promise.allSettled([
        service.execute(token, 'DELETE', `/api/members/${root.uid}`, {}, {}),
        service.execute(
          token,
          'PATCH',
          `/api/members/${root.uid}/status`,
          { status: 'disabled' },
          {},
        ),
      ])
      assert.ok(results.every((result) => result.status === 'rejected'))
      const role = (await store.read<Role>('roles', 'role_super'))!
      assert.equal(role.memberCount, 1)
      const handler = createHandler(() => service)
      const httpHeaders = {
        cookie: `__Host-ec-session=${token}`,
        origin: 'https://local-test.example',
        'content-type': 'application/json',
        'x-requested-with': 'ElectronicClub',
      }
      process.env.ALLOWED_ORIGIN = 'https://local-test.example'
      assert.equal(
        (
          await handler({
            path: '/api/auth/me',
            httpMethod: 'GET',
            headers: httpHeaders,
          })
        ).statusCode,
        200,
      )
      const output = await handler({
        path: '/api/members/export.xlsx',
        httpMethod: 'GET',
        headers: httpHeaders,
      })
      assert.equal(output.statusCode, 200)
      assert.equal(output.isBase64Encoded, true)
      const exported = new ExcelJS.Workbook()
      await exported.xlsx.load(
        Buffer.from(output.body, 'base64') as unknown as ExcelJS.Buffer,
      )
      assert.ok(exported.worksheets[0]!.rowCount > 1)
      const created = await handler({
        path: '/members',
        httpMethod: 'POST',
        headers: httpHeaders,
        isBase64Encoded: true,
        body: Buffer.from(
          JSON.stringify({ studentId: '00ef1234', name: '网关测试' }),
        ).toString('base64'),
      })
      assert.equal(created.statusCode, 200)
      assert.equal(
        (
          await handler({
            path: '/api/members',
            httpMethod: 'POST',
            headers: { ...httpHeaders, origin: 'https://invalid.example' },
            body: '{}',
          })
        ).statusCode,
        403,
      )
      await assert.rejects(() =>
        runtimePool!.query('CREATE TABLE electronicclub.forbidden(id int)'),
      )
      const unavailablePool = new Pool({
        host: '127.0.0.1',
        port: 1,
        connectionTimeoutMillis: 100,
      })
      try {
        const unavailable = createHandler(
          () => new MemberService(new PgStore(unavailablePool)),
        )
        assert.equal(
          (
            await unavailable({
              path: '/api/auth/me',
              httpMethod: 'GET',
              headers: httpHeaders,
            })
          ).statusCode,
          503,
        )
      } finally {
        await unavailablePool.end()
      }

      assert.equal(
        (await handler({ path: '/api/auth/me', httpMethod: 'GET' })).statusCode,
        401,
      )
      const failing = createHandler(() => {
        throw new Error('secret must not leak')
      })
      const failed = await failing({
        path: '/api/auth/me',
        httpMethod: 'GET',
        headers: { cookie: '__Host-ec-session=opaque' },
      })
      assert.equal(failed.statusCode, 503)
      assert.ok(!failed.body.includes('secret must not leak'))
      assert.equal(
        (await handler({ path: '/health', httpMethod: 'GET' })).statusCode,
        200,
      )
      console.log(
        'PostgreSQL integration assertions executed against a real server',
      )
    } finally {
      await runtimePool?.end()
      await pool.end()
    }
  },
)

test(
  'real PostgreSQL over HTTP RPC: bootstrap, login, imports, atomic commit, conflict retry and private grants',
  { skip: !url },
  async () => {
    const { HttpStore } = await import(
      '../apps/functions/src/members/http-store'
    )
    const { createServer } = await import('node:http')
    assert.equal(new URL(url!).hostname, '127.0.0.1')
    assert.equal(new URL(url!).pathname, '/club_test')
    const admin = new Pool({ connectionString: url })
    const restrictedUrl = new URL(url!)
    restrictedUrl.username = 'electronicclub_api'
    restrictedUrl.password = 'local-restricted-test'
    const backend = new Pool({ connectionString: restrictedUrl.href, max: 4 })
    const server = createServer(async (request, response) => {
      try {
        assert.equal(
          request.headers.authorization,
          'Bearer test-only-server-key',
        )
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const args = JSON.parse(Buffer.concat(chunks).toString())
        const operations: Record<string, [string, unknown[]]> = {
          '/ec_read': [
            'SELECT public.ec_read($1,$2) AS value',
            [args.p_collection, args.p_id],
          ],
          '/ec_list': [
            'SELECT public.ec_list($1,$2,$3,$4) AS value',
            [args.p_collection, args.p_filter, args.p_offset, args.p_limit],
          ],
          '/ec_commit': [
            'SELECT public.ec_commit($1,$2) AS value',
            [JSON.stringify(args.p_reads), JSON.stringify(args.p_writes)],
          ],
        }
        const operation = operations[request.url!]
        assert.ok(operation)
        const result = await backend.query(operation[0], operation[1])
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(result.rows[0].value))
      } catch {
        response.statusCode = 503
        response.end('{"error":"DB_FAILED"}')
      }
    })
    try {
      await admin.query(
        'TRUNCATE electronicclub.users,electronicclub.roles,electronicclub.permissions,electronicclub.system,electronicclub.audit_logs,electronicclub.import_jobs,electronicclub.login_limits CASCADE',
      )
      const sql = await readFile('cloudbase/sql/004-http-rpc.sql', 'utf8')
      await admin.query(sql)
      await admin.query(sql) // Existing data/functions are safe on retry.
      assert.equal(
        (
          await admin.query(
            "SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.ec_commit(jsonb,jsonb)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS allowed",
          )
        ).rows[0].allowed,
        false,
      )
      // A superuser key is rejected, rather than silently bypassing restricted-role checks.
      await assert.rejects(() =>
        admin.query("SELECT public.ec_read('system','control')"),
      )
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      )
      const address = server.address() as { port: number }
      let conflicts = 0
      const store = new HttpStore(async (name, args) => {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/${name}`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-only-server-key',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(args),
          },
        )
        if (!response.ok) throw new Error('HTTP_DATABASE_FAILED')
        const value = await response.json()
        if (value.conflict) conflicts++
        return value
      })
      const service = new MemberService(store)
      const password = 'HTTP-Validation-Password123'
      const root = await service.bootstrap(
        { studentId: '00httpa1', name: 'HTTP测试', nickname: 'TEST' },
        password,
      )
      await assert.rejects(() =>
        service.bootstrap(
          { studentId: '00httpa2', name: '不得重建' },
          password,
        ),
      )
      const login = await service.login(
        { studentId: '00HTTPA1', password },
        'test',
      )
      const token = login.token!
      assert.ok(token)
      assert.equal((login.data as Identity).super, true)
      assert.equal((login.data as Identity).member.nickname, 'TEST')
      assert.equal(
        (
          await service.login(
            { studentId: '00httpa1', password: 'wrong' },
            'test',
          )
        ).status,
        401,
      )
      const member = (
        await service.execute(
          token,
          'POST',
          '/api/members',
          { studentId: '001a2345', name: 'HTTP成员' },
          {},
        )
      ).data as Member
      await assert.rejects(() =>
        service.execute(
          token,
          'POST',
          '/api/members',
          { studentId: '001A2345', name: '重复' },
          {},
        ),
      )
      assert.equal(
        (
          await store.list<Member>(
            'users',
            { _search: '001a', roleIds: 'role_member' },
            { offset: 0, limit: 10 },
          )
        ).total,
        1,
      )
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(
        (await templateWorkbook()) as unknown as ExcelJS.Buffer,
      )
      book.worksheets[0]!.addRow(['000ab789', '导入HTTP'])
      const job = (
        await service.prepareImport(token, {
          file: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
        })
      ).data as ImportJob
      const results = await Promise.all(
        [0, 1].map(() =>
          service.execute(
            token,
            'POST',
            `/api/imports/${job.id}/process`,
            { offset: 0 },
            {},
          ),
        ),
      )
      assert.ok(
        results.every((result) => (result.data as ImportJob).created === 1),
      )
      assert.equal(
        (
          await store.list<Member>(
            'users',
            { _search: '000AB789' },
            { offset: 0, limit: 10 },
          )
        ).items[0]!.studentId,
        '000AB789',
      )
      // Failure after an earlier SQL write must roll back the entire RPC statement.
      await assert.rejects(() =>
        store.run(async (tx) => {
          await tx.set('system', 'must-rollback', { value: 1 })
          await tx.set('users', 'duplicate-http', {
            ...member,
            uid: 'duplicate-http',
          })
        }),
      )
      assert.equal(await store.read('system', 'must-rollback'), null)
      await store.run((tx) => tx.set('system', 'counter', { value: 0 }))
      await Promise.all(
        [0, 1, 2].map(() =>
          store.run(async (tx) => {
            const counter = (await tx.get<{ value: number }>(
              'system',
              'counter',
            ))!
            await new Promise((resolve) => setTimeout(resolve, 15))
            await tx.set('system', 'counter', { value: counter.value + 1 })
          }),
        ),
      )
      assert.equal(
        (await store.read<{ value: number }>('system', 'counter'))!.value,
        3,
      )
      assert.ok(conflicts > 0)
      const protectedResults = await Promise.allSettled([
        service.execute(token, 'DELETE', `/api/members/${root.uid}`, {}, {}),
        service.execute(
          token,
          'PATCH',
          `/api/members/${root.uid}/status`,
          { status: 'disabled' },
          {},
        ),
      ])
      assert.ok(
        protectedResults.every((result) => result.status === 'rejected'),
      )
      assert.equal(
        (await store.read<Role>('roles', 'role_super'))!.memberCount,
        1,
      )
      assert.equal(
        (await service.execute(token, 'GET', '/api/auth/me', {}, {})).status ??
          200,
        200,
      )
      console.log(
        'HTTP bridge + real PostgreSQL RPC assertions passed; NOT a CloudBase production deployment test',
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await backend.end()
      await admin.end()
    }
  },
)

test(
  'managed PostgreSQL: existing service_role installs atomically without CREATEROLE; browser roles cannot read private data',
  { skip: !url },
  async () => {
    const { HttpStore } = await import(
      '../apps/functions/src/members/http-store'
    )
    assert.equal(new URL(url!).hostname, '127.0.0.1')
    assert.equal(new URL(url!).pathname, '/club_test')
    const admin = new Pool({ connectionString: url })
    let owner: Pool | undefined, gateway: Pool | undefined
    try {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await admin.query(
          `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$`,
        )
      }
      await admin.query(
        "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='club_managed_owner') THEN CREATE ROLE club_managed_owner LOGIN PASSWORD 'local-managed-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$",
      )
      await admin.query('DROP DATABASE IF EXISTS club_managed_test')
      await admin.query(
        'CREATE DATABASE club_managed_test OWNER club_managed_owner',
      )
      const databaseUrl = new URL(url!)
      databaseUrl.pathname = '/club_managed_test'
      gateway = new Pool({ connectionString: databaseUrl.href, max: 3 })
      databaseUrl.username = 'club_managed_owner'
      databaseUrl.password = 'local-managed-only'
      owner = new Pool({ connectionString: databaseUrl.href, max: 1 })
      assert.equal(
        (
          await owner.query(
            'SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user',
          )
        ).rows[0].rolcreaterole,
        false,
      )
      await assert.rejects(
        () => owner!.query('CREATE ROLE forbidden_managed_role'),
        (error: unknown) => (error as { code: string }).code === '42501',
      )
      const install = await readFile(
        'cloudbase/sql/editor-https-install.sql',
        'utf8',
      )
      assert.ok(!install.includes('electronicclub_api'))
      assert.ok(!/^\s*(?:CREATE|ALTER) ROLE /m.test(install))
      await admin.query('GRANT service_role TO authenticated')
      await assert.rejects(
        () => owner!.query(install),
        /PUBLIC_ROLE_INHERITS_PRIVATE_ACCESS/,
      )
      await owner.query('ROLLBACK')
      assert.equal(
        (
          await owner.query(
            "SELECT to_regclass('electronicclub.users') AS name",
          )
        ).rows[0].name,
        null,
      )
      await admin.query('REVOKE service_role FROM authenticated')
      await owner.query(install)
      await owner.query(install)
      assert.ok(
        (
          await owner.query(
            "SELECT to_regprocedure('public.ec_read(text,text)') AS name",
          )
        ).rows[0].name,
      )
      async function asRole(
        role: 'service_role' | 'anon' | 'authenticated',
        sql: string,
        args: unknown[] = [],
      ) {
        const client = await gateway!.connect()
        try {
          await client.query('BEGIN')
          await client.query(`SET LOCAL ROLE ${role}`)
          const result = await client.query(sql, args)
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      }
      const store = new HttpStore(async (name, args) => {
        const calls: Record<string, [string, unknown[]]> = {
          ec_read: [
            'SELECT public.ec_read($1,$2) AS value',
            [args.p_collection, args.p_id],
          ],
          ec_list: [
            'SELECT public.ec_list($1,$2,$3,$4) AS value',
            [args.p_collection, args.p_filter, args.p_offset, args.p_limit],
          ],
          ec_commit: [
            'SELECT public.ec_commit($1,$2) AS value',
            [JSON.stringify(args.p_reads), JSON.stringify(args.p_writes)],
          ],
        }
        const call = calls[name]!
        return (await asRole('service_role', call[0], call[1])).rows[0].value
      })
      const service = new MemberService(store)
      const root = await service.bootstrap(
        { studentId: '00managed1', name: 'Managed test', nickname: 'TEST' },
        'Managed-Test-Password123',
      )
      const login = await service.login(
        { studentId: '00MANAGED1', password: 'Managed-Test-Password123' },
        'local',
      )
      assert.equal((login.data as Identity).super, true)
      assert.ok(login.token)
      await owner.query(install)
      assert.equal(
        (await store.read<Member>('users', root.uid))!.studentId,
        '00MANAGED1',
      )
      assert.ok(
        (await service.execute(login.token!, 'GET', '/api/auth/me', {}, {}))
          .data,
      )
      for (const role of ['anon', 'authenticated'] as const) {
        await assert.rejects(
          () =>
            asRole(role, "SELECT public.ec_read('credentials',$1)", [root.uid]),
          (error: unknown) => (error as { code: string }).code === '42501',
        )
        await assert.rejects(
          () => asRole(role, 'SELECT data FROM electronicclub.users'),
          (error: unknown) => (error as { code: string }).code === '42501',
        )
        await assert.rejects(
          () => asRole(role, 'SELECT data FROM electronicclub.sessions'),
          (error: unknown) => (error as { code: string }).code === '42501',
        )
      }
      // The schema owner is not silently treated as the HTTP runtime identity.
      await assert.rejects(
        () => owner!.query("SELECT public.ec_read('users',$1)", [root.uid]),
        /UNSAFE_BACKEND_ROLE/,
      )
      await assert.rejects(() =>
        store.run(async (tx) => {
          await tx.set('system', 'managed-rollback', { value: 1 })
          await tx.set('users', 'managed-duplicate', {
            ...(await store.read<Member>('users', root.uid))!,
            uid: 'managed-duplicate',
          })
        }),
      )
      assert.equal(await store.read('system', 'managed-rollback'), null)
      const legacyBefore = (
        await owner.query(
          'SELECT (SELECT jsonb_agg(data ORDER BY id) FROM electronicclub.users) AS users,(SELECT jsonb_agg(data ORDER BY id) FROM electronicclub.roles) AS roles,(SELECT jsonb_agg(data ORDER BY id) FROM electronicclub.credentials) AS credentials',
        )
      ).rows[0]
      await owner.query(await readFile('cloudbase/sql/008-stage3.sql', 'utf8'))
      await owner.query(await readFile('cloudbase/sql/008-stage3.sql', 'utf8'))
      assert.deepEqual(
        (
          await owner.query(
            'SELECT (SELECT jsonb_agg(data ORDER BY id) FROM electronicclub.users) AS users,(SELECT jsonb_agg(data ORDER BY id) FROM electronicclub.roles) AS roles,(SELECT jsonb_agg(data ORDER BY id) FROM electronicclub.credentials) AS credentials',
          )
        ).rows[0],
        legacyBefore,
      )
      const { stage3Suite } = await import('./helpers/stage3-suite')
      await stage3Suite(service, store, login.token!)
      console.log(
        'Managed-role SQL executed by a real NOCREATEROLE schema owner; service-role bootstrap/login and browser isolation passed',
      )
    } finally {
      await owner?.end()
      await gateway?.end()
      await admin.query('REVOKE service_role FROM authenticated')
      await admin.query('DROP DATABASE IF EXISTS club_managed_test')
      await admin.end()
    }
  },
)
