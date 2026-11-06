import { ApiError } from './members/model'

export const BACKEND_BODY_REVISION = 'gateway-body-v5'
type Stage = 'flag' | 'type' | 'base64' | 'limit' | 'utf8' | 'json'
interface Diagnostic {
  stage: Stage
  bodyType: string
  flagType: string
  flagValue: 'missing' | 'true' | 'false' | 'invalid'
  wireBytes: number | null
  decodedBytes: number | null
  wireShape: string
  decodedShape: string
}
export class HttpBodyError extends ApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    public diagnostic: Diagnostic,
  ) {
    super(status, code, message)
  }
}
function shape(bytes: Buffer) {
  if (!bytes.length) return 'empty'
  const prefix = bytes.subarray(0, 128).toString('utf8').trimStart()
  if (prefix.includes('\0')) return 'nul-bytes'
  if (prefix.startsWith('{') || prefix.startsWith('[')) return 'json-container'
  if (/^"/.test(prefix)) return 'json-string'
  if (/^\d{1,3}(?:,\d{1,3}){3}/.test(prefix)) return 'comma-bytes'
  if (/^%(?:7b|5b)/i.test(prefix)) return 'percent-encoded'
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(prefix)) return 'base64-like'
  return 'other'
}

/** Decode the gateway envelope, then parse JSON once. Never retain/log content. */
export function parseHttpBody(
  event: { body?: unknown; isBase64Encoded?: unknown },
  maxBytes = 3_100_000,
): unknown {
  const body = event.body,
    flag = event.isBase64Encoded
  const diagnostic: Diagnostic = {
    stage: 'flag',
    bodyType: body == null ? 'missing' : typeof body,
    flagType: flag == null ? 'missing' : typeof flag,
    flagValue: 'invalid',
    wireBytes: null,
    decodedBytes: null,
    wireShape: 'unread',
    decodedShape: 'unread',
  }
  function fail(
    stage: Stage,
    status: number,
    code: string,
    message: string,
  ): never {
    throw new HttpBodyError(status, code, message, { ...diagnostic, stage })
  }
  let encoded = false
  if (flag == null || flag === '') diagnostic.flagValue = 'missing'
  else if (typeof flag === 'boolean') {
    encoded = flag
    diagnostic.flagValue = flag ? 'true' : 'false'
  } else if (typeof flag === 'string' && /^(true|false)$/i.test(flag.trim())) {
    encoded = flag.trim().toLowerCase() === 'true'
    diagnostic.flagValue = encoded ? 'true' : 'false'
  } else fail('flag', 400, 'INVALID_BODY_ENCODING', '网关正文编码标记格式错误')

  let wire: Buffer
  const wireLimit = encoded ? Math.ceil(maxBytes / 3) * 4 + 16 : maxBytes
  const tooLarge = () =>
    fail(
      'limit',
      413,
      'BODY_TOO_LARGE',
      maxBytes === 65536
        ? '内容请求超过64KB，请分片上传图片或缩短正文'
        : '请求体过大',
    )
  const fromText = (text: string) => {
    diagnostic.wireBytes = Buffer.byteLength(text)
    diagnostic.wireShape = shape(Buffer.from(text.slice(0, 128)))
    if (diagnostic.wireBytes > wireLimit) tooLarge()
    return Buffer.from(text, 'utf8')
  }
  if (body == null) wire = Buffer.alloc(0)
  else if (typeof body === 'string') wire = fromText(body)
  else if (Buffer.isBuffer(body)) {
    diagnostic.bodyType = 'buffer'
    wire = body
  } else if (body instanceof ArrayBuffer) {
    diagnostic.bodyType = 'array-buffer'
    wire = Buffer.from(body)
  } else if (ArrayBuffer.isView(body)) {
    diagnostic.bodyType = 'array-buffer-view'
    wire = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  } else if (
    !encoded &&
    typeof body === 'object' &&
    (Array.isArray(body) ||
      Object.getPrototypeOf(body) === Object.prototype ||
      Object.getPrototypeOf(body) === null)
  ) {
    // Some HTTP adapters already parsed application/json. Re-serialize only
    // this data-only gateway representation; business validation is unchanged.
    diagnostic.bodyType = 'json-object'
    let text: string
    try {
      text = JSON.stringify(body)
    } catch {
      return fail('type', 400, 'INVALID_BODY_TYPE', '网关正文类型不受支持')
    }
    wire = fromText(text)
  } else return fail('type', 400, 'INVALID_BODY_TYPE', '网关正文类型不受支持')
  diagnostic.wireBytes = wire.length
  diagnostic.wireShape = shape(wire)
  if (wire.length > wireLimit) tooLarge()

  let decoded = wire
  if (encoded) {
    const compact = wire.toString('utf8').replace(/\s/g, '')
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact) || compact.length % 4 === 1)
      return fail(
        'base64',
        400,
        'INVALID_BODY_ENCODING',
        '网关Base64正文格式错误',
      )
    decoded = Buffer.from(compact, 'base64')
    const canonical = decoded.toString('base64').replace(/=+$/, '')
    if (
      canonical !==
      compact.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
    )
      return fail(
        'base64',
        400,
        'INVALID_BODY_ENCODING',
        '网关Base64正文格式错误',
      )
  }
  diagnostic.decodedBytes = decoded.length
  diagnostic.decodedShape = shape(decoded)
  if (decoded.length > maxBytes) tooLarge()
  if (!decoded.length) return {}
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(decoded),
    )
  } catch {
    return fail('utf8', 400, 'INVALID_JSON', 'JSON正文不是有效的UTF-8文本')
  }
  try {
    return JSON.parse(text)
  } catch {
    return fail('json', 400, 'INVALID_JSON', 'JSON格式错误')
  }
}
