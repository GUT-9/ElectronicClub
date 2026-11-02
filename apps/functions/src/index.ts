import type { HealthResponse, ApiResponse } from '@electronic-club/shared'
export interface HttpEvent { path?: string; httpMethod?: string; headers?: Record<string, string | undefined> }
export interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }
export async function main(event: HttpEvent): Promise<HttpResult> {
  const origin = process.env.ALLOWED_ORIGIN
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' }
  if (origin && event.headers?.origin === origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
  }
  const respond = (statusCode: number, body: HealthResponse | ApiResponse<never>): HttpResult => ({ statusCode, headers, body: JSON.stringify(body) })
  if (event.path !== '/api/health') return respond(404, { success: false, error: { code: 'NOT_FOUND', message: '接口不存在' } })
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return respond(405, { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET' } })
  return respond(200, { success: true, data: { status: 'ok', service: 'ElectronicClub API', timestamp: new Date().toISOString() } })
}
