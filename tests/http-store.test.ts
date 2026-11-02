import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudbaseRpc } from '../apps/functions/src/members/http-store'
import { DatabaseFailure } from '../apps/functions/src/members/pg-store'
test('official HTTPS transport uses environment ID and private Bearer key; failures are sanitized', async () => {
  const oldEnv = process.env.CLOUDBASE_ENV_ID,
    oldKey = process.env.CLOUDBASE_APIKEY,
    oldFetch = globalThis.fetch
  try {
    delete process.env.CLOUDBASE_APIKEY
    assert.throws(() => cloudbaseRpc(), DatabaseFailure)
    process.env.CLOUDBASE_ENV_ID = 'local-test-env'
    process.env.CLOUDBASE_APIKEY = 'private-test-only'
    globalThis.fetch = async (url, options) => {
      assert.equal(
        url,
        'https://local-test-env.api.tcloudbasegateway.com/v1/rdb/rest/rpc/ec_read',
      )
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        'Bearer private-test-only',
      )
      assert.equal(
        (options!.headers as Record<string, string>)['Accept-Profile'],
        'public',
      )
      assert.deepEqual(JSON.parse(options!.body as string), {
        p_collection: 'system',
        p_id: 'control',
      })
      return new Response('{"data":null,"etag":null}')
    }
    assert.deepEqual(
      await cloudbaseRpc()('ec_read', {
        p_collection: 'system',
        p_id: 'control',
      }),
      { data: null, etag: null },
    )
    globalThis.fetch = async () =>
      new Response('secret-provider-error', { status: 403 })
    await assert.rejects(
      cloudbaseRpc()('ec_read', {}),
      (error) =>
        error instanceof DatabaseFailure &&
        error.safeCode === 'RDB_HTTP_PERMISSION_DENIED' &&
        !error.message.includes('secret'),
    )
    for (const [code, expected] of [
      ['PGRST202', 'RDB_RPC_NOT_INSTALLED'],
      ['42P01', 'RDB_SCHEMA_NOT_INSTALLED'],
      ['42501', 'RDB_HTTP_PERMISSION_DENIED'],
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ code, message: 'secret' }), {
          status: 400,
        })
      await assert.rejects(
        cloudbaseRpc()('ec_read', {}),
        (error) =>
          error instanceof DatabaseFailure && error.safeCode === expected,
      )
    }
    globalThis.fetch = async () => {
      throw new Error('secret-network-error')
    }
    await assert.rejects(
      cloudbaseRpc()('ec_read', {}),
      (error) =>
        error instanceof DatabaseFailure &&
        error.safeCode === 'RDB_HTTP_UNREACHABLE',
    )
  } finally {
    globalThis.fetch = oldFetch
    if (oldEnv === undefined) delete process.env.CLOUDBASE_ENV_ID
    else process.env.CLOUDBASE_ENV_ID = oldEnv
    if (oldKey === undefined) delete process.env.CLOUDBASE_APIKEY
    else process.env.CLOUDBASE_APIKEY = oldKey
  }
})
