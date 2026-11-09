import type { ClubEvent, ClubArticle, PopupAnnouncement } from './stage3'
import type { ForumBoard, ForumPostView, ForumCommentView } from './forum'
import type { ClubResource } from './resources'

export const PUBLIC_SITE_KEY = 'electronicclub/public-site/v1/site.json'
export const PUBLIC_SITE_MAX_BYTES = 8 * 1024 * 1024
export interface PublicAsset { key: string; mime: string; bytes: number }
export interface PublicSite {
  format: 'eclub-public-v1'
  generatedAt: string
  revision: string
  events: Omit<ClubEvent, 'managerIds' | 'registrationIds'>[]
  articles: ClubArticle[]
  popups: PopupAnnouncement[]
  boards: ForumBoard[]
  posts: ForumPostView[]
  comments: ForumCommentView[]
  resources: (ClubResource & { downloadUrl: string })[]
  assets: Record<string, PublicAsset>
  hasTimedPopups?: boolean
  timedMediaIds?: string[]
}
export class PublicSiteError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
const fail = (status: number, code: string, message: string): never => {
  throw new PublicSiteError(status, code, message)
}
export function publicOrigin(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password ||
      url.hostname === 'localhost' || url.hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(url.hostname))
    throw new Error('INVALID_PUBLIC_ORIGIN')
  return url.origin
}
export function isPublicSitePath(path: string, q: Record<string, string>) {
  if (q.live === 'true' || q.admin === 'true' || q.status) return false
  return /^\/api\/public\/(events|articles)(?:\/[a-f0-9-]{36})?$/.test(path) ||
    path === '/api/public/popup' || path === '/api/resources' ||
    /^\/api\/resources\/[a-f0-9-]{36}\/download$/.test(path) ||
    /^\/api\/media\/[a-f0-9-]{36}$/.test(path) ||
    /^\/api\/forum\/(?:boards(?:\/[a-zA-Z0-9-]{1,60})?|posts(?:\/[a-f0-9-]{36}(?:\/comments)?)?|images\/[a-f0-9-]{36})$/.test(path)
}
function page<T>(items: T[], q: Record<string, string>, max = 100) {
  const number = (name: string, fallback: number, limit: number) => {
    const value = q[name] === undefined ? fallback : Number(q[name])
    if (!Number.isSafeInteger(value) || value < 1 || value > limit)
      fail(400, 'INVALID_INPUT', '分页参数无效')
    return value
  }
  const current = number('page', 1, 10000), size = number('pageSize', 20, max)
  return { items: items.slice((current - 1) * size, current * size), total: items.length, page: current, pageSize: size }
}
const missing = (): never => fail(404, 'NOT_FOUND', '内容尚未公开或不存在')
const text = (q: Record<string, string>, key: string, max: number) => {
  const value = q[key] ?? ''
  if (value.length > max) fail(400, 'INVALID_INPUT', '查询内容过长')
  return value
}
export function readPublicSite(site: PublicSite, path: string, q: Record<string, string>, now = Date.now()):
  { data?: unknown; asset?: PublicAsset } {
  if (!isPublicSitePath(path, q)) missing()
  if (path.startsWith('/api/media/') || path.startsWith('/api/forum/images/')) {
    const asset = site.assets[path]
    if (!asset) missing()
    return { asset }
  }
  if (path === '/api/public/popup') {
    const stamp = new Date(now).toISOString()
    const eligible = site.popups.filter((p) => p.enabled && !['retired', 'disabled'].includes(p.state) &&
      p.startsAt <= stamp && p.expiresAt > stamp &&
      (p.targetType === 'event' ? site.events : site.articles).some((v) => v.id === p.targetId))
    eligible.sort((a, b) => b.priority - a.priority || b.startsAt.localeCompare(a.startsAt) ||
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return { data: eligible[0] ? { ...eligible[0], state: 'active' } : null }
  }
  if (path.startsWith('/api/public/')) {
    const [, , , kind, id] = path.split('/')
    const rows = kind === 'events' ? site.events : site.articles
    if (id) return { data: rows.find((v) => v.id === id) ?? missing() }
    const search = text(q, 'search', 100), category = text(q, 'category', 100)
    const items = rows.filter((v) => v.title.includes(search) && (!category || ('category' in v && v.category === category)))
      .sort((a, b) => Number('pinned' in b && b.pinned) - Number('pinned' in a && a.pinned) ||
        String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id))
    return { data: page(items, q) }
  }
  if (path.startsWith('/api/resources')) {
    if (path.endsWith('/download')) {
      const record = site.resources.find((v) => v.id === path.split('/')[3]) ?? missing()
      return { data: { url: record.downloadUrl, filename: record.originalName } }
    }
    const search = text(q, 'search', 80).trim().toLowerCase(), category = text(q, 'category', 40).trim()
    const items = site.resources.filter((v) => (!category || v.category === category) &&
      [v.title, v.description, v.originalName].join(' ').toLowerCase().includes(search))
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id))
      .map(({ downloadUrl: _url, ...metadata }) => { void _url; return metadata })
    return { data: page(items, q, 50) }
  }
  const [, , , kind, id, action] = path.split('/')
  if (kind === 'boards') {
    if (id) return { data: site.boards.find((v) => v.id === id) ?? missing() }
    return { data: page([...site.boards].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)), q) }
  }
  if (id) {
    const post = site.posts.find((v) => v.id === id) ?? missing()
    if (!action) return { data: post }
    const items = site.comments.filter((v) => v.postId === id).sort((a, b) => a.floor - b.floor)
    if (q.anchor) {
      const index = items.findIndex((v) => v.id === q.anchor)
      if (index < 0) missing()
      q = { ...q, page: String(1 + Math.floor(index / 20)), pageSize: '20' }
    }
    return { data: page(items, q) }
  }
  const search = text(q, 'search', 80).toLowerCase(), board = text(q, 'boardId', 60), sort = q.sort ?? 'latest'
  if (!['latest', 'reply', 'hot', 'featured'].includes(sort)) fail(400, 'INVALID_INPUT', '排序方式无效')
  const items = site.posts.filter((v) => (!board || v.boardId === board) &&
    (!search || (v.title + ' ' + v.body).toLowerCase().includes(search)) && (sort !== 'featured' || v.featured))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
      (sort === 'hot' ? (b.likeCount * 3 + b.commentCount * 2) - (a.likeCount * 3 + a.commentCount * 2) : 0) ||
      (sort === 'reply' ? b.lastReplyAt.localeCompare(a.lastReplyAt) : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id))
    .map((v) => ({ ...v, body: v.body.slice(0, 240) }))
  return { data: page(items, q) }
}

export async function limitedBytes(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit || !response.body)
    throw new Error('PUBLIC_RESPONSE_SIZE')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      const value: unknown = part.value
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) :
        ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null
      if (!bytes || (size += bytes.byteLength) > limit) throw new Error('PUBLIC_RESPONSE_SIZE')
      chunks.push(new Uint8Array(bytes))
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
export async function fetchPublicSite(origin: string, send: typeof fetch = fetch, now = Date.now()) {
  const base = publicOrigin(origin)
  const response = await send(`${base}/${PUBLIC_SITE_KEY}?v=${Math.floor(now / 5000)}`, {
    cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('PUBLIC_SITE_UNAVAILABLE')
  const site = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await limitedBytes(response, PUBLIC_SITE_MAX_BYTES))) as PublicSite
  if (site.format !== 'eclub-public-v1' || typeof site.revision !== 'string' ||
      !['events', 'articles', 'popups', 'boards', 'posts', 'comments', 'resources'].every((k) => Array.isArray(site[k as keyof PublicSite])) ||
      !site.assets || typeof site.assets !== 'object') throw new Error('PUBLIC_SITE_FORMAT')
  return site
}
export async function fetchPublicAsset(origin: string, asset: PublicAsset, send: typeof fetch = fetch) {
  if (!/^electronicclub\/public-site\/v1\/assets\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(asset.key) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 51200) throw new Error('PUBLIC_ASSET_FORMAT')
  const response = await send(`${publicOrigin(origin)}/${asset.key}`, {
    cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('PUBLIC_ASSET_UNAVAILABLE')
  const bytes = await limitedBytes(response, 51200)
  if (bytes.length !== asset.bytes) throw new Error('PUBLIC_ASSET_SIZE')
  return bytes
}

export function budgetEstimate(pricePerCoreSecond: number | null, days: number, minutesPerDay: number, reserve = 300) {
  const target = 1500
  if (!Number.isFinite(days) || days < 0 || days > 31 || !Number.isFinite(minutesPerDay) || minutesPerDay < 0 || minutesPerDay > 1440 ||
      !Number.isFinite(reserve) || reserve < 0 || reserve >= target) throw new Error('INVALID_BUDGET')
  const windows = Math.ceil(minutesPerDay / 5) * Math.ceil(days)
  if (pricePerCoreSecond === null) return { target, reserve, windows, estimated: null, maxWindows: null, withinTarget: null }
  if (!Number.isFinite(pricePerCoreSecond) || pricePerCoreSecond <= 0) throw new Error('INVALID_PRICE')
  const estimated = windows * 150 * pricePerCoreSecond + reserve
  return { target, reserve, windows, estimated, maxWindows: Math.floor((target - reserve) / (150 * pricePerCoreSecond)), withinTarget: estimated <= target }
}
