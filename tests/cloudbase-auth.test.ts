import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudbaseAuthorization } from '../apps/functions/src/members/cloudbase-auth'
import { cloudbaseRpc } from '../apps/functions/src/members/http-store'
import { DatabaseFailure } from '../apps/functions/src/members/pg-store'

test('SCF identity exchanges signed credentials, shares refresh, caches tokens and respects credential rotation', async () => {
  const names = [
    'CLOUDBASE_APIKEY',
    'CLOUDBASE_ENV_ID',
    'TENCENTCLOUD_SECRETID',
    'TENCENTCLOUD_SECRETKEY',
    'TENCENTCLOUD_SESSIONTOKEN',
  ] as const
  const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    ),
    oldFetch = globalThis.fetch
  try {
    for (const name of names) delete process.env[name]
    const auth = cloudbaseAuthorization('local-test-env')
    await assert.rejects(
      auth.header(),
      (error) =>
        error instanceof DatabaseFailure &&
        error.safeCode === 'CLOUDBASE_IDENTITY_UNAVAILABLE',
    )
    process.env.TENCENTCLOUD_SECRETID = 'test-id'
    process.env.TENCENTCLOUD_SECRETKEY = 'test-secret'
    process.env.TENCENTCLOUD_SESSIONTOKEN = 'test-sts-token'
    let exchanges = 0
    globalThis.fetch = async (url, options) => {
      assert.equal(
        url,
        'https://local-test-env.api.tcloudbasegateway.com/auth/v1/token/clientCredential',
      )
      assert.equal(options!.method, 'POST')
      assert.deepEqual(JSON.parse(options!.body as string), {
        grant_type: 'client_credentials',
      })
      const header = (options!.headers as Record<string, string>).Authorization
      assert.match(header, /^TC3-HMAC-SHA256 /)
      assert.match(header, /, Timestamp=\d+, Token=test-sts-token$/)
      assert.ok(!header.includes('test-secret'))
      exchanges++
      return new Response(
        JSON.stringify({
          access_token: `token-${exchanges}`,
          expires_in: 3600,
        }),
      )
    }
    assert.deepEqual(await Promise.all([auth.header(), auth.header()]), [
      'Bearer token-1',
      'Bearer token-1',
    ])
    assert.equal(await auth.header(), 'Bearer token-1')
    assert.equal(exchanges, 1)
    process.env.TENCENTCLOUD_SECRETKEY = 'rotated-test-secret'
    assert.equal(await auth.header(), 'Bearer token-2')
    auth.invalidate()
    assert.equal(await auth.header(), 'Bearer token-3')
    process.env.CLOUDBASE_APIKEY = 'optional-test-key'
    assert.equal(await auth.header(), 'Bearer optional-test-key')
    assert.equal(exchanges, 3)
    delete process.env.CLOUDBASE_APIKEY
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 7_200_000
      assert.equal(await auth.header(), 'Bearer token-4')
    } finally {
      Date.now = realNow
    }
    auth.invalidate()
    globalThis.fetch = async () =>
      new Response('sensitive-provider-error', { status: 403 })
    await assert.rejects(
      auth.header(),
      (error) =>
        error instanceof DatabaseFailure &&
        error.safeCode === 'CLOUDBASE_IDENTITY_REJECTED' &&
        !error.message.includes('sensitive'),
    )
    globalThis.fetch = async () => new Response('{"message":"no token"}')
    await assert.rejects(
      auth.header(),
      (error) =>
        error instanceof DatabaseFailure &&
        error.safeCode === 'CLOUDBASE_IDENTITY_INVALID_RESPONSE',
    )
    globalThis.fetch = async () => {
      throw new Error('sensitive-network-error')
    }
    await assert.rejects(
      auth.header(),
      (error) =>
        error instanceof DatabaseFailure &&
        error.safeCode === 'CLOUDBASE_IDENTITY_UNREACHABLE',
    )
    // Actual transport sends the exchanged Bearer token, not STS secrets, to SQL RPC.
    process.env.CLOUDBASE_ENV_ID = 'local-test-env'
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/clientCredential'))
        return new Response(
          '{"access_token":"runtime-token","expires_in":3600}',
        )
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        'Bearer runtime-token',
      )
      return new Response('{"data":null,"etag":null}')
    }
    assert.deepEqual(
      await cloudbaseRpc()('ec_read', {
        p_collection: 'system',
        p_id: 'control',
      }),
      { data: null, etag: null },
    )
  } finally {
    globalThis.fetch = oldFetch
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
})
