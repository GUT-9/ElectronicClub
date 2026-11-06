import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  QiniuProvider,
  safe64,
  validateFileHeader,
} from '../apps/functions/src/resources/qiniu'
import type { ResourceRecord } from '../apps/functions/src/resources/model'
import { MemoryStore } from '../apps/functions/src/members/memory-store'
import { MemberService } from '../apps/functions/src/members/service'
import { TestResourceProvider, resourcesSuite } from './helpers/resources-suite'
test('member activation and public resource library: unique users, reset/deactivation, RBAC, publishing, reservation concurrency and safe cleanup', async () => {
  let now = Date.now()
  const store = new MemoryStore(),
    provider = new TestResourceProvider(),
    service = new MemberService(store, () => now, provider)
  await service.bootstrap(
    { studentId: '00RESROOT', name: '资料管理员' },
    'Resource-Root123',
  )
  const root = (
    await service.login(
      { studentId: '00RESROOT', password: 'Resource-Root123' },
      'root',
    )
  ).token!
  await resourcesSuite(service, store, root, provider, (ms) => (now += ms))
})
test('Qiniu policies and management/download signatures match official v1 HMAC rules; size/magic checked and keys isolated', async () => {
  const names = [
    'QINIU_ACCESS_KEY',
    'QINIU_SECRET_KEY',
    'QINIU_BUCKET',
    'QINIU_DOWNLOAD_DOMAIN',
    'QINIU_UPLOAD_URL',
    'QINIU_RESOURCE_MAX_BYTES',
    'QINIU_RESOURCE_BUDGET_BYTES',
  ]
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]))
  Object.assign(process.env, {
    QINIU_ACCESS_KEY: 'test-access',
    QINIU_SECRET_KEY: 'test-secret',
    QINIU_BUCKET: 'test-resources',
    QINIU_DOWNLOAD_DOMAIN: 'https://files.example.test',
  })
  for (const n of names.slice(4)) delete process.env[n]
  try {
    const now = Date.now(),
      record: ResourceRecord = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: '参考',
        description: '',
        category: '教程',
        originalName: '参考.pdf',
        size: 12,
        mime: 'application/pdf',
        key: 'electronicclub/resources/v1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
        bucket: 'test-resources',
        ownerUid: 'test-owner',
        hash: '',
        status: 'uploading',
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 600000).toISOString(),
        publishedAt: null,
      }
    const calls: string[] = []
    const provider = new QiniuProvider(async (url, options) => {
      const address = String(url)
      calls.push(address)
      if (address.startsWith('https://rs.qiniu.com/stat/')) {
        const path = new URL(address).pathname
        assert.equal(
          (options!.headers as Record<string, string>).Authorization,
          'QBox test-access:' +
            safe64(
              createHmac('sha1', 'test-secret')
                .update(path + '\n')
                .digest(),
            ),
        )
        return new Response(
          JSON.stringify({
            fsize: 12,
            mimeType: 'application/pdf',
            hash: 'TestQiniuHash0123456789abcdef',
          }),
        )
      }
      assert.equal(
        (options!.headers as Record<string, string>).Range,
        'bytes=0-8191',
      )
      assert.equal(options!.redirect, 'manual')
      return new Response('%PDF-1.7\nabc', { status: 206 })
    })
    const ticket = provider.ticket(record, now),
      parts = ticket.token.split(':')
    assert.equal(parts[0], 'test-access')
    assert.equal(
      parts[1],
      safe64(createHmac('sha1', 'test-secret').update(parts[2]).digest()),
    )
    const policy = JSON.parse(
      Buffer.from(
        parts[2].replaceAll('-', '+').replaceAll('_', '/'),
        'base64',
      ).toString(),
    )
    assert.equal(policy.scope, 'test-resources:' + record.key)
    assert.equal(policy.insertOnly, 1)
    assert.equal(policy.fsizeLimit, 12)
    assert.equal(policy.fsizeMin, 12)
    assert.ok(
      policy.mimeLimit.includes('application/pdf') &&
        !policy.mimeLimit.includes('text/html'),
    )
    assert.ok(policy.deadline <= Math.floor(now / 1000) + 600)
    assert.ok(!ticket.token.includes('test-secret'))
    assert.ok((await provider.verify(record)).hash)
    assert.equal(calls.length, 2)
    assert.throws(
      () =>
        provider.ticket({ ...record, key: 'unrelated-existing-file.pdf' }, now),
      /对象标识/,
    )
    assert.throws(
      () =>
        validateFileHeader(
          'evil.pdf',
          Buffer.from('<script>alert(1)</script>'),
        ),
      /格式不符/,
    )
    assert.throws(
      () => validateFileHeader('evil.exe', Buffer.from('MZ')),
      /支持/,
    )
    assert.throws(
      () => validateFileHeader('evil.txt', Buffer.from('<html>bad</html>')),
      /格式不符/,
    )
    assert.throws(
      () => provider.ticket({ ...record, bucket: 'other-bucket' }, now),
      /配置不同/,
    )
    validateFileHeader('参考.pdf', Buffer.from('%PDF-1.7'))
    process.env.QINIU_DOWNLOAD_DOMAIN = 'http://files.example.test'
    assert.equal(provider.status().configured, false)
  } finally {
    for (const n of names) {
      if (old[n] === undefined) delete process.env[n]
      else process.env[n] = old[n]
    }
  }
})
