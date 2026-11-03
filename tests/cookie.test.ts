import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionCookieConfig } from '../apps/functions/src/members/cookie'
test('cross-site cookie requires Secure and an exact HTTPS origin; default remains Lax', () => {
  const keys = ['COOKIE_SAMESITE', 'COOKIE_SECURE', 'ALLOWED_ORIGIN'] as const
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    delete process.env.COOKIE_SAMESITE
    assert.equal(sessionCookieConfig().sameSite, 'Lax')
    process.env.COOKIE_SAMESITE = 'none'
    process.env.COOKIE_SECURE = 'false'
    process.env.ALLOWED_ORIGIN = 'https://example.test'
    assert.throws(() => sessionCookieConfig())
    process.env.COOKIE_SECURE = 'true'
    process.env.ALLOWED_ORIGIN = 'http://example.test'
    assert.throws(() => sessionCookieConfig())
    process.env.ALLOWED_ORIGIN = 'https://example.test'
    assert.equal(sessionCookieConfig().sameSite, 'None')
    process.env.COOKIE_SAMESITE = 'invalid'
    assert.throws(() => sessionCookieConfig())
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k]
      else process.env[k] = old[k]
    }
  }
})
