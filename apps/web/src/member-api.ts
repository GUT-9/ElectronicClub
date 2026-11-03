import type { ApiResponse, Page, Role } from '@electronic-club/shared'
import { MAX_CONTENT_REQUEST_BYTES } from './cover'
export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message)
  }
}
const base = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
export async function request<T>(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const serialized = data === undefined ? undefined : JSON.stringify(data)
  if (serialized && /^\/(events|articles|popups)(?:\/|$)/.test(path) && new TextEncoder().encode(serialized).byteLength > MAX_CONTENT_REQUEST_BYTES)
    throw new RequestError('内容请求超过64KB安全预算，请重新选择封面以自动压缩，或缩短正文；尚未提交保存。', 'PAYLOAD_TOO_LARGE', 413)
  const response = await fetch(`${base}/api${path}`, {
    method,
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ElectronicClub',
    },
    body: serialized,
    signal: AbortSignal.timeout(60000),
  })
  if (response.status === 413)
    throw new RequestError('服务器拒绝了过大的请求（413），请压缩封面或缩短正文后重试。', 'PAYLOAD_TOO_LARGE', 413)
  const body: ApiResponse<T> = await response.json()
  if (!body.success)
    throw new RequestError(body.error.message, body.error.code, response.status)
  return body.data
}
export async function download(path: string, filename: string) {
  const response = await fetch(`${base}/api${path}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) {
    const body = await response.json()
    throw new Error(body.error?.message ?? '下载失败')
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function allRoles() {
  const items: Role[] = []
  for (let page = 1; page <= 100; page++) {
    const data = await request<Page<Role>>(`/roles?page=${page}`)
    items.push(...data.items)
    if (items.length >= data.total) break
  }
  return items
}
