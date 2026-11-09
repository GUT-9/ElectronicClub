/// <reference types="vite/client" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../apps/web/src/stores/auth'
test('login is complete only after cookie-backed session recovery; 200 then 401 displays a useful error', async () => {
  const original = globalThis.fetch
  const identity = {
    member: { uid: 'test-only', mustChangePassword: false },
    roles: [],
    permissions: [],
    super: false,
  }
  try {
    setActivePinia(createPinia())
    const store = useAuthStore()
    let cookiesBlocked = true
    const calls: string[] = []
    globalThis.fetch = async (url, options) => {
      calls.push(String(url))
      assert.equal(options!.credentials, 'include')
      if (String(url).endsWith('/auth/me') && cookiesBlocked)
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UNAUTHENTICATED', message: '请先登录' },
          }),
          { status: 401 },
        )
      return new Response(JSON.stringify({ success: true, data: identity }))
    }
    await assert.rejects(
      store.login('00TEST1', 'test-password'),
      /浏览器未能恢复登录会话/,
    )
    assert.equal(store.identity, null)
    assert.deepEqual(calls, ['/api/auth/login', '/api/auth/me'])
    cookiesBlocked = false
    await store.login('00TEST1', 'test-password')
    assert.equal(store.member?.uid, 'test-only')
  } finally {
    globalThis.fetch = original
  }
})

test('concurrent session restores share a request and a stale response cannot undo clear', async () => {
  const original = globalThis.fetch
  try {
    setActivePinia(createPinia())
    const store = useAuthStore()
    let calls = 0
    let finish!: (response: Response) => void
    globalThis.fetch = async () => {
      calls++
      return new Promise<Response>((resolve) => { finish = resolve })
    }
    const first = store.restore(), second = store.restore(true)
    assert.equal(calls, 1)
    store.clear()
    finish(new Response(JSON.stringify({ success: true, data: {
      member: { uid: 'stale-session' }, permissions: [], roles: [], super: false,
    } })))
    await Promise.all([first, second])
    assert.equal(store.identity, null)
    assert.equal(store.restored, true)
    const third = store.restore(true)
    assert.equal(calls, 2)
    finish(new Response(JSON.stringify({ success: false, error: {
      code: 'UNAUTHENTICATED', message: '请先登录',
    } }), { status: 401 }))
    await third
    assert.equal(store.identity, null)
  } finally {
    globalThis.fetch = original
  }
})
