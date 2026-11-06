import { isIP } from 'node:net'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeProxySecret } from '@electronic-club/shared'
export interface LoginMetadata {
  memberUid: string | null
  ip: string | null
  ipSource: 'gateway' | 'trusted-header' | 'unavailable'
  userAgent: string
  device: string
  os: string
  browser: string
  outcome: 'success' | 'failure' | 'blocked'
  reason: string
}
export type LoginContext = Pick<
  LoginMetadata,
  'ip' | 'ipSource' | 'userAgent' | 'device' | 'os' | 'browser'
>
function ip(value: unknown) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  return candidate.length <= 64 && isIP(candidate) ? candidate : null
}
// Optional authenticated metadata from our EdgeOne entry point. Plain forwarded
// headers never override gateway metadata. The key is server-side on both ends.
export function signedProxyIp(
  headers: Record<string, string | undefined>,
  now = Date.now(),
) {
  const key = normalizeProxySecret(process.env.ECLUB_PROXY_SECRET),
    address = ip(headers['x-eclub-client-ip']),
    timestamp = headers['x-eclub-proxy-time'],
    signature = headers['x-eclub-proxy-signature']
  if (
    !key ||
    !address ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 60_000 ||
    !signature ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    return null
  const expected = createHmac('sha256', key)
    .update(
      `eclub-proxy-ip-v1\n${timestamp}\n${address}\n${headers['user-agent'] ?? ''}`,
    )
    .digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
    ? address
    : null
}
export function loginContext(
  context:
    | {
        sourceIp?: string
        http?: { sourceIp?: string }
        identity?: { sourceIp?: string }
      }
    | undefined,
  headers: Record<string, string | undefined>,
): LoginContext {
  const signed = signedProxyIp(headers)
  let address =
    signed ||
    ip(context?.sourceIp) ||
    ip(context?.http?.sourceIp) ||
    ip(context?.identity?.sourceIp)
  let ipSource: LoginContext['ipSource'] = signed
    ? 'trusted-header'
    : address
      ? 'gateway'
      : 'unavailable'
  // Opt-in only after the HTTP gateway strips and overwrites this header.
  // Raw client X-Forwarded-For is otherwise untrusted.
  const trusted = process.env.LOGIN_TRUSTED_IP_HEADER
  if (!address && ['x-real-ip', 'x-forwarded-for'].includes(trusted ?? '')) {
    const value = headers[trusted!]
    address = ip(trusted === 'x-forwarded-for' ? value?.split(',')[0] : value)
    if (address) ipSource = 'trusted-header'
  }
  const userAgent = (headers['user-agent'] ?? '')
    .slice(0, 512)
    .split('')
    .map((c) => {
      const n = c.charCodeAt(0)
      return n < 32 || (n >= 127 && n <= 159) ? ' ' : c
    })
    .join('')
    .trim()
  const version = (pattern: RegExp) =>
    pattern.exec(userAgent)?.[1]?.replaceAll('_', '.') ?? ''
  let browser = '未识别',
    os = '未识别',
    device = '其他设备'
  const browsers: [string, RegExp][] = [
    ['Edge', /(?:Edg|EdgA|EdgiOS)\/([\d.]{1,24})/],
    ['Opera', /(?:OPR|Opera)\/([\d.]{1,24})/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]{1,24})/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]{1,24})/],
    ['Safari', /Version\/([\d.]{1,24}).*Safari\//],
  ]
  for (const [name, pattern] of browsers) {
    const v = version(pattern)
    if (v) {
      browser = name + ' ' + v
      break
    }
  }
  if (/Android/i.test(userAgent)) {
    os = 'Android ' + version(/Android ([\d.]{1,16})/)
    device = /Mobile/i.test(userAgent) ? '手机' : '平板'
  } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
    os = 'iOS ' + version(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]{1,16})/)
    device = /iPad/.test(userAgent) ? '平板' : '手机'
  } else if (/Windows NT/i.test(userAgent)) {
    const v = version(/Windows NT ([\d.]{1,16})/)
    os = v === '10.0' ? 'Windows 10/11' : 'Windows ' + v
    device = '电脑'
  } else if (/Macintosh|Mac OS X/i.test(userAgent)) {
    os = 'macOS ' + version(/Mac OS X ([\d_]{1,16})/)
    device = /Mobile/.test(userAgent) ? '平板' : '电脑'
  } else if (/Linux/i.test(userAgent)) {
    os = 'Linux'
    device = '电脑'
  }
  return {
    ip: address,
    ipSource,
    userAgent,
    device: device.trim(),
    os: os.trim(),
    browser,
  }
}
export function safeLoginContext(value: string | LoginContext): LoginContext {
  if (typeof value === 'string') return loginContext({ sourceIp: value }, {})
  const parsed = loginContext(
    value.ipSource === 'gateway'
      ? { sourceIp: value.ip ?? undefined }
      : undefined,
    { 'user-agent': value.userAgent },
  )
  // The only structured caller is our HTTP adapter; still canonicalize its IP.
  const address = ip(value.ip)
  return {
    ...parsed,
    ip: address,
    ipSource: address ? value.ipSource : 'unavailable',
  }
}
