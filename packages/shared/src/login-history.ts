export interface LoginRecord {
  id: string
  createdAt: string
  memberUid: string | null
  name: string
  studentId: string
  outcome: 'success' | 'failure' | 'blocked'
  reason: string
  ip: string | null
  ipSource: 'gateway' | 'trusted-header' | 'unavailable' | 'legacy'
  device: string
  os: string
  browser: string
  userAgent: string
  legacy: boolean
  anonymized: boolean
}
