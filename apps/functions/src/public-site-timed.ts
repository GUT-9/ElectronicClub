import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type { PopupAnnouncement } from '@electronic-club/shared'
export const TIMED_SITE_KEY = 'electronicclub/public-site/v1/timed.bin'
export interface TimedSite {
  popups: PopupAnnouncement[]
  retired: string[]
  assets: Record<string, { mime: string; base64: string; popupIds: string[] }>
}
const key = () => {
  if (!process.env.QINIU_SECRET_KEY) throw Error('PUBLIC_TIMED_KEY_NOT_CONFIGURED')
  return createHash('sha256').update('eclub-timed-v1\n' + process.env.QINIU_SECRET_KEY).digest()
}
export function encryptTimed(value: TimedSite) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), nonce)
  cipher.setAAD(Buffer.from('eclub-timed-v1'))
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return Buffer.concat([Buffer.from('ECT1'), nonce, cipher.getAuthTag(), bytes])
}
export function decryptTimed(bytes: Uint8Array): TimedSite {
  const value = Buffer.from(bytes)
  if (value.length < 32 || value.subarray(0, 4).toString() !== 'ECT1') throw Error('PUBLIC_TIMED_FORMAT')
  const cipher = createDecipheriv('aes-256-gcm', key(), value.subarray(4, 16))
  cipher.setAAD(Buffer.from('eclub-timed-v1'))
  cipher.setAuthTag(value.subarray(16, 32))
  const data = JSON.parse(Buffer.concat([cipher.update(value.subarray(32)), cipher.final()]).toString()) as TimedSite
  if (!Array.isArray(data.popups) || !Array.isArray(data.retired) || !data.assets) throw Error('PUBLIC_TIMED_FORMAT')
  return data
}
export const popupVersion = (p: PopupAnnouncement) => p.id + ':' + p.version
export function scheduledPopup(data: TimedSite, now: number) {
  const retired = new Set(data.retired)
  const events = [...new Set(data.popups.flatMap((p) => [Math.max(Date.parse(p.startsAt), Date.parse(p.createdAt)), Date.parse(p.expiresAt)]))]
    .filter((v) => Number.isFinite(v) && v <= now).sort((a, b) => a - b)
  let current: PopupAnnouncement | null = null
  for (const time of events) {
    const eligible = data.popups.filter((p) => p.enabled && !['retired','disabled'].includes(p.state) && !retired.has(popupVersion(p)) &&
      Math.max(Date.parse(p.startsAt), Date.parse(p.createdAt)) <= time && Date.parse(p.expiresAt) > time)
      .sort((a, b) => b.priority - a.priority || b.startsAt.localeCompare(a.startsAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    const chosen = eligible[0] ?? null
    if (current && current.id !== chosen?.id) retired.add(popupVersion(current))
    current = chosen
  }
  return { popup: current ? { ...current, state: 'active' as const } : null, retired: [...retired] }
}
