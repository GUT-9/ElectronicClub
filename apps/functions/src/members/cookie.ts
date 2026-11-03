import { DatabaseFailure } from './pg-store'
export function sessionCookieConfig() {
  const secure = process.env.COOKIE_SECURE !== 'false'
  const value = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase()
  if (!['lax', 'strict', 'none'].includes(value))
    throw new DatabaseFailure('configuration', 'INVALID_COOKIE_SAMESITE')
  if (value === 'none') {
    const origin = process.env.ALLOWED_ORIGIN
    let valid = false
    try {
      const url = new URL(origin!)
      valid = url.protocol === 'https:' && url.origin === origin
    } catch {
      /* Invalid origin stays rejected. */
    }
    if (!secure || !valid)
      throw new DatabaseFailure(
        'configuration',
        'CROSS_SITE_COOKIE_REQUIRES_HTTPS',
      )
  }
  return {
    name: secure ? '__Host-ec-session' : 'ec-session',
    secure,
    sameSite: value === 'none' ? 'None' : value === 'strict' ? 'Strict' : 'Lax',
  }
}
export function sessionCookie(token: string, clear = false) {
  const config = sessionCookieConfig()
  return `${config.name}=${token}; Path=/; HttpOnly; SameSite=${config.sameSite}; Max-Age=${clear ? 0 : 28800}${config.secure ? '; Secure' : ''}`
}
