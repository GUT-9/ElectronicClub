import { HEALTH_PATH, type HealthResponse } from '@electronic-club/shared'

export class HealthCheckError extends Error {
  constructor(
    message: string,
    public endpoint: string,
  ) {
    super(message)
  }
}

export async function requestHealth(
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<HealthResponse> {
  let response: Response
  try {
    response = await fetcher(endpoint, { signal: AbortSignal.timeout(8000) })
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    throw new HealthCheckError(
      timedOut
        ? 'API 请求超时'
        : '无法访问 API，请检查网络、跨域配置或浏览器拦截',
      endpoint,
    )
  }
  if (!response.ok)
    throw new HealthCheckError(
      `API 返回 HTTP ${response.status}，请检查服务地址和网关`,
      endpoint,
    )
  if (response.headers.get('content-type')?.includes('text/html'))
    throw new HealthCheckError(
      'API 返回了网页，请检查 API 地址或静态站点回退配置',
      endpoint,
    )
  let body: HealthResponse
  try {
    body = await response.json()
  } catch {
    throw new HealthCheckError('API 未返回有效 JSON', endpoint)
  }
  if (
    !body ||
    body.success !== true ||
    body.data?.status !== 'ok' ||
    body.data.service !== 'ElectronicClub API'
  )
    throw new HealthCheckError('API 健康检查响应格式不匹配', endpoint)
  return body
}

export async function getHealth(): Promise<HealthResponse> {
  const endpoint = new URL(HEALTH_PATH, window.location.origin)
  // Diagnostics show only the request destination, never query strings or URL credentials.
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new HealthCheckError(
      'API 地址应只包含源地址，不能含账号、密码、查询参数或片段',
      endpoint.origin + endpoint.pathname,
    )
  return requestHealth(endpoint.href)
}
