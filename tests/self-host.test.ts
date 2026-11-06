import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trustedSource } from '../apps/functions/src/self-host/server'
test('self-host trusts proxy IP only with the private overwritten token and a valid IP', () => {
  const key = 'a'.repeat(64)
  assert.equal(
    trustedSource('172.18.0.2', { 'x-real-ip': '203.0.113.6' }, key),
    '172.18.0.2',
  )
  assert.equal(
    trustedSource(
      '172.18.0.2',
      { 'x-real-ip': '203.0.113.6', 'x-eclub-proxy-token': 'bad' },
      key,
    ),
    '172.18.0.2',
  )
  assert.equal(
    trustedSource(
      '172.18.0.2',
      { 'x-real-ip': '203.0.113.6', 'x-eclub-proxy-token': key },
      key,
    ),
    '203.0.113.6',
  )
  assert.equal(
    trustedSource(
      '172.18.0.2',
      { 'x-real-ip': 'bad', 'x-eclub-proxy-token': key },
      key,
    ),
    '172.18.0.2',
  )
  assert.equal(
    trustedSource(
      '172.18.0.2',
      { 'x-real-ip': '203.0.113.6', 'x-eclub-proxy-token': '界'.repeat(64) },
      key,
    ),
    '172.18.0.2',
  )
})
