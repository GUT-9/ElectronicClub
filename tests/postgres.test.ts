import { test } from 'node:test'
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
