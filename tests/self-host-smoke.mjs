import assert from 'node:assert/strict'
const base = 'https://localhost:18443'
let cookie = ''
async function call(path, method = 'GET', body, guest = false) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'X-Requested-With': 'ElectronicClub',
      cookie: guest ? '' : cookie,
      'X-Real-IP': '192.0.2.99',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.headers.get('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0]
  return response
}
async function data(path, method = 'GET', body) {
  const r = await call(path, method, body)
  assert.equal(r.status, 200, await r.clone().text())
  return (await r.json()).data
}
const mode = process.argv[2]
const login = await data('/api/auth/login', 'POST', {
  studentId: '00LINUXROOT',
  password: 'Linux-Test123',
})
assert.equal(login.super, true)
assert.equal((await data('/api/auth/me')).member.uid, login.member.uid)
assert.equal((await call('/api/members', 'GET', undefined, true)).status, 401)
assert.equal((await call('/api/unknown')).status, 404)
for (const path of [
  '/resources',
  '/community/11111111-1111-4111-8111-111111111111',
  '/admin/events',
]) {
  const r = await call(path)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/html/)
}
assert.equal((await call('/assets/missing.js')).status, 404)
assert.equal(
  (
    await fetch(base + '/api/profile', {
      method: 'PATCH',
      headers: {
        Origin: 'https://untrusted.example',
        'Content-Type': 'application/json',
        'X-Requested-With': 'ElectronicClub',
        cookie,
      },
      body: JSON.stringify({ nickname: 'must-not-change' }),
    })
  ).status,
  403,
)
if (mode === 'seed') {
  await data('/api/members', 'POST', {
    studentId: '00LINUXMEMBER',
    name: 'Backup preserved member',
  })
  const event = await data('/api/events', 'POST', {
    title: 'Linux backup event',
    status: 'published',
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
    registrationEnabled: true,
    registrationDeadline: new Date(Date.now() + 3600000).toISOString(),
    checkinEnabled: true,
  })
  await data(`/api/events/${event.id}/registration`, 'POST', {})
  const log = await data('/api/login-history?search=00LINUXROOT')
  assert.ok(
    log.items.some((r) => r.ip && r.ip !== '192.0.2.99'),
    'Proxy must overwrite the forged IP',
  )
} else if (mode === 'mutate')
  await data('/api/members', 'POST', {
    studentId: '00LINUXAFTER',
    name: 'Created after backup',
  })
else if (mode === 'restored') {
  const list = await data('/api/members?search=00LINUXAFTER&status=all')
  assert.equal(list.total, 0)
  assert.equal((await data('/api/members?search=00LINUXMEMBER')).total, 1)
  const events = await data('/api/events?search=Linux%20backup%20event')
  assert.equal(events.total, 1)
  assert.equal(
    (await data(`/api/events/${events.items[0].id}/registrations`)).total,
    1,
  )
}
console.log('PASS self-host ' + mode)
