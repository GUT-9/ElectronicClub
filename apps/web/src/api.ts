import { HEALTH_PATH, type HealthResponse } from '@electronic-club/shared'
export async function getHealth(): Promise<HealthResponse> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
  const response = await fetch(`${base}${HEALTH_PATH}`, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body: HealthResponse = await response.json()
  if (!body.success) throw new Error(body.error.message)
  if (body.data.status !== 'ok' || body.data.service !== 'ElectronicClub API') throw new Error('健康检查响应无效')
  return body
}
