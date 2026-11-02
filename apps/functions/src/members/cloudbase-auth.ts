import { createHash } from 'node:crypto'
import { sign } from '@cloudbase/signature-nodejs'
import { DatabaseFailure } from './pg-store'

// Matches @cloudbase/node-sdk 3.18.7 auth.getClientCredential() and its TC3 requester.
// Credentials are supplied by SCF's execution identity, never by an HTTP caller.
export function cloudbaseAuthorization(env: string) {
  let cached: { token: string; until: number; fingerprint: string } | undefined
  let pending: { fingerprint: string; promise: Promise<string> } | undefined
  const invalidate = () => {
    cached = undefined
  }
  async function header(): Promise<string> {
    if (process.env.CLOUDBASE_APIKEY)
      return `Bearer ${process.env.CLOUDBASE_APIKEY}`
    const secretId = process.env.TENCENTCLOUD_SECRETID,
      secretKey = process.env.TENCENTCLOUD_SECRETKEY,
      sessionToken = process.env.TENCENTCLOUD_SESSIONTOKEN
    if (!secretId || !secretKey)
      throw new DatabaseFailure(
        'runtime_identity',
        'CLOUDBASE_IDENTITY_UNAVAILABLE',
      )
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([secretId, secretKey, sessionToken]))
      .digest('hex')
    if (cached?.fingerprint === fingerprint && cached.until > Date.now())
      return `Bearer ${cached.token}`
    if (!pending || pending.fingerprint !== fingerprint) {
      const exchange = async () => {
        const url = `https://${env}.api.tcloudbasegateway.com/auth/v1/token/clientCredential`
        const body = { grant_type: 'client_credentials' }
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Host: new URL(url).host,
          'X-TCB-Source': `${process.env.TCB_SOURCE || ''},scf`,
          'X-Client-Timestamp': String(Date.now()),
          'X-SDK-Version': 'tcb-node-sdk/3.18.7',
        }
        if (process.env.TENCENTCLOUD_REGION)
          headers['X-TCB-Region'] = process.env.TENCENTCLOUD_REGION
        const signed = sign({
          secretId,
          secretKey,
          method: 'POST',
          url,
          params: body,
          headers,
          timestamp: Math.floor(Date.now() / 1000) - 1,
          withSignedParams: false,
          isCloudApi: true,
        })
        headers.Authorization = `${signed.authorization}, Timestamp=${signed.timestamp}${sessionToken ? `, Token=${sessionToken}` : ''}`
        let response: Response
        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
          })
        } catch {
          throw new DatabaseFailure(
            'identity_exchange',
            'CLOUDBASE_IDENTITY_UNREACHABLE',
          )
        }
        if (!response.ok)
          throw new DatabaseFailure(
            'identity_exchange',
            'CLOUDBASE_IDENTITY_REJECTED',
          )
        let result: { access_token?: unknown; expires_in?: unknown }
        try {
          result = await response.json()
        } catch {
          throw new DatabaseFailure(
            'identity_exchange',
            'CLOUDBASE_IDENTITY_INVALID_RESPONSE',
          )
        }
        if (
          !result ||
          typeof result.access_token !== 'string' ||
          !result.access_token
        )
          throw new DatabaseFailure(
            'identity_exchange',
            'CLOUDBASE_IDENTITY_INVALID_RESPONSE',
          )
        const lifetime =
          typeof result.expires_in === 'number' &&
          Number.isFinite(result.expires_in)
            ? Math.max(0, Math.min(result.expires_in, 3600) - 60)
            : 0
        cached = {
          token: result.access_token,
          until: Date.now() + lifetime * 1000,
          fingerprint,
        }
        return `Bearer ${result.access_token}`
      }
      pending = { fingerprint, promise: exchange() }
    }
    const active = pending
    try {
      return await active.promise
    } finally {
      if (pending === active) pending = undefined
    }
  }
  return { header, invalidate }
}
