import { createHmac } from 'node:crypto'
import { QiniuProvider, safe64 } from './resources/qiniu'
import { fetchPublicSite, fetchPublicAsset, publicOrigin, PUBLIC_SITE_KEY } from '@electronic-club/shared/public-site'
import type { PublicSite, PublicAsset } from '@electronic-club/shared/public-site'
import { limitedBytes, PUBLIC_SITE_MAX_BYTES } from '@electronic-club/shared/public-site'
import { encryptTimed, decryptTimed, TIMED_SITE_KEY } from './public-site-timed'
import type { TimedSite } from './public-site-timed'

export interface PublicSiteStorage {
  configured(): boolean
  origin(): string
  read(): Promise<PublicSite | null>
  asset(value: PublicAsset): Promise<Uint8Array>
  timed(): Promise<TimedSite | null>
  putTimed(value: TimedSite): Promise<void>
  put(key: string, data: Uint8Array, mime: string): Promise<void>
  remove(key: string): Promise<void>
}
export class QiniuPublicSiteStorage implements PublicSiteStorage {
  constructor(private send: typeof fetch = fetch) {}
  origin() { return publicOrigin(process.env.PUBLIC_SITE_ORIGIN ?? process.env.QINIU_DOWNLOAD_DOMAIN ?? '') }
  configured() {
    try { return !!this.origin() && new QiniuProvider(this.send).status().configured }
    catch { return false }
  }
  private config(key: string) {
    if (!this.configured()) throw Error('PUBLIC_STORAGE_NOT_CONFIGURED')
    if (![PUBLIC_SITE_KEY, TIMED_SITE_KEY].includes(key) && !/^electronicclub\/public-site\/v1\/assets\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(key))
      throw Error('PUBLIC_OBJECT_KEY')
    return { bucket: process.env.QINIU_BUCKET!, ak: process.env.QINIU_ACCESS_KEY!, sk: process.env.QINIU_SECRET_KEY! }
  }
  async read() {
    let missing = false
    try {
      return await fetchPublicSite(this.origin(), async (url, options) => {
        const response = await this.send(url, options)
        missing = response.status === 404 || response.status === 612
        return response
      })
    } catch (error) { if (missing) return null; throw error }
  }
  async asset(value: PublicAsset) { return fetchPublicAsset(this.origin(), value, this.send) }
  async timed() {
    const response = await this.send(`${this.origin()}/${TIMED_SITE_KEY}?v=${Math.floor(Date.now() / 5000)}`, {
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000),
    })
    if ([404, 612].includes(response.status)) return null
    if (!response.ok) throw Error('PUBLIC_TIMED_UNAVAILABLE')
    return decryptTimed(await limitedBytes(response, PUBLIC_SITE_MAX_BYTES))
  }
  async putTimed(value: TimedSite) {
    const bytes = encryptTimed(value)
    if (bytes.length > PUBLIC_SITE_MAX_BYTES) throw Error('PUBLIC_TIMED_TOO_LARGE')
    await this.put(TIMED_SITE_KEY, bytes, 'application/octet-stream')
  }
  async put(key: string, data: Uint8Array, mime: string) {
    const c = this.config(key), url = process.env.QINIU_UPLOAD_URL ?? 'https://upload.qiniup.com'
    if (!/^https:\/\/(?:upload|up)(?:-[a-z0-9-]+)?\.(?:qiniup\.com|qbox\.me)$/.test(url)) throw Error('PUBLIC_UPLOAD_HOST')
    const policy = safe64(JSON.stringify({ scope: `${c.bucket}:${key}`, deadline: Math.floor(Date.now() / 1000) + 120,
      insertOnly: 0, fsizeLimit: data.length, mimeLimit: mime }))
    const signature = safe64(createHmac('sha1', c.sk).update(policy).digest())
    const form = new FormData()
    form.set('key', key)
    form.set('token', `${c.ak}:${signature}:${policy}`)
    form.set('file', new Blob([new Uint8Array(data)], { type: mime }), key.split('/').pop()!)
    const response = await this.send(url, { method: 'POST', body: form, redirect: 'manual', signal: AbortSignal.timeout(8000) })
    if (!response.ok || (await response.json() as { key?: string }).key !== key) throw Error('PUBLIC_UPLOAD_FAILED')
  }
  async remove(key: string) {
    const c = this.config(key)
    if ([PUBLIC_SITE_KEY, TIMED_SITE_KEY].includes(key)) throw Error('PUBLIC_MANIFEST_DELETE_FORBIDDEN')
    const path = '/delete/' + safe64(c.bucket + ':' + key)
    const response = await this.send('https://rs.qiniu.com' + path, {
      method: 'POST', body: '', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `QBox ${c.ak}:${safe64(createHmac('sha1', c.sk).update(path + '\n').digest())}` },
    })
    if (!response.ok && ![404, 612].includes(response.status)) throw Error('PUBLIC_DELETE_FAILED')
  }
}
