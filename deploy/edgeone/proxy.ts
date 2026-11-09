// The upstream is fixed server-side. Request parameters never select a host.
import { normalizeProxySecret } from '@electronic-club/shared/proxy-secret'
import { fetchPublicSite, fetchPublicAsset, isPublicSitePath, readPublicSite, PublicSiteError, safePublicOrigin } from '@electronic-club/shared/public-site'
export const DEFAULT_API_UPSTREAM =
  'https://natural-tuna-d6gptlw1w76fa8a63-1448063817.ap-shanghai.app.tcloudbase.com'
export interface ProxyContext {
  request: Request
  env?: Record<string, string | undefined>
  eo?: { clientIp?: string }
}
const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
])
const maxBody = 3_100_000
const revision = 'gateway-body-v5'
function failure(status: number, code: string, message: string) {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-EClub-API-Transport': 'same-origin',
        'X-EClub-API-Revision': revision,
      },
    },
  )
}
async function bodyBytes(request: Request) {
  if (!request.body) return undefined
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // Edge runtimes can yield ArrayBuffer or views, rather than Uint8Array.
      // Uint8Array.set(ArrayBuffer) silently copies nothing, producing NULs.
      let chunk: Uint8Array
      if (value instanceof ArrayBuffer) chunk = new Uint8Array(value)
      else if (ArrayBuffer.isView(value))
        chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      else throw new Error('Unsupported request stream chunk')
      size += chunk.byteLength
      if (size > maxBody) {
        await reader.cancel()
        return null
      }
      chunks.push(new Uint8Array(chunk))
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
export async function proxyApi(
  context: ProxyContext,
  fetcher: typeof fetch = fetch,
) {
  try {
    return await forwardApi(context, fetcher)
  } catch {
    return failure(
      502,
      'API_PROXY_UNAVAILABLE',
      '暂时无法连接后端，请稍后重试或联系管理员',
    )
  }
}
async function forwardApi(context: ProxyContext, fetcher: typeof fetch) {
  const { request } = context,
    url = new URL(request.url)
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/'))
    return failure(404, 'NOT_FOUND', '接口不存在')
  if (!methods.has(request.method))
    return failure(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法')
  if (request.method === 'GET' && context.env?.PUBLIC_SITE_ORIGIN) {
    const query = Object.fromEntries(url.searchParams)
    if (url.pathname === '/api/public-site/config')
      return new Response(JSON.stringify({ success: true, data: { mode: 'qiniu', target: 1500, reader: 'edgeone', origin: safePublicOrigin(context.env.PUBLIC_SITE_ORIGIN) } }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    if (isPublicSitePath(url.pathname, {}) && !isPublicSitePath(url.pathname, query)) {
      if (query.live !== 'true' && query.admin !== 'true') return failure(400, 'INVALID_INPUT', '公开查询参数无效')
      if (!/__Host-ec-session=[A-Za-z0-9_-]+(?:;|$)/.test(request.headers.get('cookie') ?? ''))
        return failure(401, 'UNAUTHENTICATED', '请先登录')
    }
    if (isPublicSitePath(url.pathname, query)) {
      try {
        const origin = context.env.PUBLIC_SITE_ORIGIN
        const site = await fetchPublicSite(origin, fetcher)
        if ((url.pathname === '/api/public/popup' && site.hasTimedPopups) ||
            (url.pathname.startsWith('/api/media/') && site.timedMediaIds?.includes(url.pathname.split('/').pop()!)))
          return forwardApi({ ...context, env: { ...context.env, PUBLIC_SITE_ORIGIN: undefined } }, fetcher)
        const result = readPublicSite(site, url.pathname, query)
        const publicHeaders = { 'Content-Type': result.asset?.mime ?? 'application/json; charset=utf-8',
          'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'X-EClub-Public-Delivery': 'qiniu-v1', 'X-EClub-API-Revision': revision }
        const body = result.asset ? (await fetchPublicAsset(origin, result.asset, fetcher)).buffer as ArrayBuffer :
          JSON.stringify({ success: true, data: result.data })
        return new Response(body, { headers: publicHeaders })
      } catch (error) {
        // Never wake the database on a cache miss, malformed input or storage outage.
        if (error instanceof PublicSiteError) return failure(error.status, error.code, error.message)
        return failure(503, 'PUBLIC_SITE_UNAVAILABLE', '公开内容暂时无法读取，请稍后重试')
      }
    }
  }
  let target: URL
  try {
    const value = context.env?.API_UPSTREAM_ORIGIN ?? DEFAULT_API_UPSTREAM
    target = new URL(value)
    if (
      target.protocol !== 'https:' ||
      target.origin !== value ||
      target.origin === url.origin ||
      target.username ||
      target.password
    )
      throw Error('Invalid upstream')
  } catch {
    return failure(
      503,
      'API_PROXY_CONFIGURATION',
      'API 转发地址配置有误，请联系管理员',
    )
  }
  target.pathname = url.pathname
  target.search = url.search
  const headers = new Headers()
  for (const name of [
    'accept',
    'content-type',
    'origin',
    'x-requested-with',
    'user-agent',
  ]) {
    const value = request.headers.get(name)
    if (value !== null)
      headers.set(name, name === 'user-agent' ? value.slice(0, 512) : value)
  }
  // Other site/platform cookies and caller-supplied forwarding/signature headers
  // must never be sent to the backend.
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => /^__Host-ec-session=[A-Za-z0-9_-]+$/.test(v))
  if (cookie) headers.set('cookie', cookie)
  headers.set('accept-encoding', 'identity')
  headers.set('cache-control', 'no-store')
  const configuredSecret = context.env?.ECLUB_PROXY_SECRET
  const secret = normalizeProxySecret(configuredSecret)
  if (configuredSecret && !secret)
    return failure(
      503,
      'API_PROXY_SECRET_FORMAT',
      'EdgeOne 的 ECLUB_PROXY_SECRET 请填写4位数字，并与云函数中的值保持一致',
    )
  if (secret) {
    const ip = context.eo?.clientIp?.trim()
    if (ip && ip.length <= 64 && /^[0-9a-f:.]+$/i.test(ip)) {
      const timestamp = String(Date.now()),
        agent = headers.get('user-agent') ?? ''
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(
            `eclub-proxy-ip-v1\n${timestamp}\n${ip}\n${agent}`,
          ),
        ),
      )
      headers.set('x-eclub-client-ip', ip)
      headers.set('x-eclub-proxy-time', timestamp)
      headers.set(
        'x-eclub-proxy-signature',
        Array.from(signature, (v) => v.toString(16).padStart(2, '0')).join(''),
      )
    }
  }
  if (Number(request.headers.get('content-length')) > maxBody)
    return failure(413, 'BODY_TOO_LARGE', '请求体过大')
  const bytes = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await bodyBytes(request)
  if (bytes === null) return failure(413, 'BODY_TOO_LARGE', '请求体过大')
  let body: string | ArrayBuffer | undefined
  if (bytes !== undefined) {
    if (
      (headers.get('content-type') ?? '')
        .toLowerCase()
        .startsWith('application/json')
    ) {
      try {
        // Node fetch accepts Uint8Array, but edge runtimes/gateways may treat it
        // as binary or coerce it to a comma-separated list of byte values.
        // Forward JSON as UTF-8 text exactly once, without JSON.stringify.
        body = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes)
      } catch {
        return failure(400, 'INVALID_JSON', 'JSON正文必须使用有效的UTF-8编码')
      }
    } else {
      body = bytes.buffer
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55_000)
  try {
    const upstream = await fetcher(target.href, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })
    // Do not follow redirects with credentials or send the browser back to a
    // cross-site API. No fallback to a cross-site request is performed.
    if (upstream.status >= 300 && upstream.status < 400)
      return failure(
        502,
        'API_PROXY_REDIRECT',
        '后端返回了意外跳转，请联系管理员检查网关',
      )
    const responseHeaders = new Headers(upstream.headers)
    for (const name of [
      'connection',
      'keep-alive',
      'transfer-encoding',
      'content-length',
      'content-encoding',
    ])
      responseHeaders.delete(name)
    responseHeaders.set('Cache-Control', 'no-store')
    responseHeaders.set('CDN-Cache-Control', 'no-store')
    responseHeaders.set('Surrogate-Control', 'no-store')
    responseHeaders.set('X-EClub-API-Transport', 'same-origin')
    responseHeaders.set('X-EClub-API-Revision', revision)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch {
    return failure(
      controller.signal.aborted ? 504 : 502,
      'API_PROXY_UNAVAILABLE',
      '暂时无法连接后端，请稍后重试或联系管理员',
    )
  } finally {
    clearTimeout(timeout)
  }
}
