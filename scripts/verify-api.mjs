// Protected-terminal verification only. Never logs response bodies, passwords or cookies.
const base = process.env.VERIFY_API_BASE?.replace(/\/$/, ''),
  origin = process.env.VERIFY_ORIGIN
let stage = 'configuration'
try {
  if (!base || !origin || !base.startsWith('https://'))
    throw new Error('CONFIGURATION_REQUIRED')
  const headers = {
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Requested-With': 'ElectronicClub',
  }
  async function call(path, method = 'GET', body, cookie) {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    return response
  }
  stage = 'health'
  if ((await call('/health')).status !== 200) throw new Error('HEALTH_FAILED')
  stage = 'anonymous'
  if ((await call('/auth/me')).status !== 401)
    throw new Error('ANONYMOUS_STATUS_FAILED')
  if (!process.argv.includes('--public-only')) {
    if (!process.env.VERIFY_STUDENT_ID || !process.env.VERIFY_PASSWORD)
      throw new Error('CREDENTIALS_REQUIRED')
    stage = 'login'
    const login = await call('/auth/login', 'POST', {
      studentId: process.env.VERIFY_STUDENT_ID,
      password: process.env.VERIFY_PASSWORD,
    })
    if (login.status !== 200) throw new Error('LOGIN_FAILED')
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('COOKIE_NOT_PASSED_THROUGH')
    stage = 'restore'
    const me = await call('/auth/me', 'GET', undefined, cookie)
    if (me.status !== 200) throw new Error('RESTORE_FAILED')
    const identity = (await me.json()).data
    if (
      !identity?.super ||
      !identity.permissions?.includes('roles.manage') ||
      !identity.permissions?.includes('members.create')
    )
      throw new Error('ADMIN_PERMISSIONS_FAILED')
    stage = 'logout'
    if ((await call('/auth/logout', 'POST', {}, cookie)).status !== 200)
      throw new Error('LOGOUT_FAILED')
    stage = 'revocation'
    if ((await call('/auth/me', 'GET', undefined, cookie)).status !== 401)
      throw new Error('REVOCATION_FAILED')
  }
  console.log(
    'API verification passed. Does not establish browser cross-site cookie compatibility or production-domain permission.',
  )
} catch {
  console.error(JSON.stringify({ code: 'API_VALIDATION_FAILED', stage }))
  process.exitCode = 1
}
