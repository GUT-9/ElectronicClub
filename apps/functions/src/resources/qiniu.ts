import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { ApiError, ensure } from '../members/model'
import type { ResourceRecord } from './model'
import { fileType } from './model'
import { RESOURCE_TYPES } from '@electronic-club/shared'
export interface ResourceProvider {
  status(): {
    configured: boolean
    bucket: string
    domain: string
    maxBytes: number
    budget: number
  }
  ticket(
    record: ResourceRecord,
    now: number,
  ): { uploadUrl: string; token: string; key: string; expiresAt: string }
  verify(record: ResourceRecord): Promise<{ hash: string }>
  remove(record: ResourceRecord): Promise<void>
  download(record: ResourceRecord): string
}
export const safe64 = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
const sign = (value: string, secret: string) =>
  safe64(createHmac('sha1', secret).update(value).digest())
export class QiniuProvider implements ResourceProvider {
  constructor(private send: typeof fetch = fetch) {}
  status() {
    let valid = true
    const bucket = process.env.QINIU_BUCKET ?? '',
      domain = process.env.QINIU_DOWNLOAD_DOMAIN ?? ''
    try {
      const u = new URL(domain)
      valid =
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.port &&
        u.pathname === '/' &&
        !u.search &&
        !u.hash &&
        !isIP(u.hostname) &&
        u.hostname !== 'localhost'
    } catch {
      valid = false
    }
    const maxBytes = Number(process.env.QINIU_RESOURCE_MAX_BYTES ?? 52428800),
      budget = Number(process.env.QINIU_RESOURCE_BUDGET_BYTES ?? 134217728)
    return {
      configured:
        valid &&
        !!process.env.QINIU_ACCESS_KEY &&
        !!process.env.QINIU_SECRET_KEY &&
        /^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}$/.test(bucket) &&
        Number.isSafeInteger(maxBytes) &&
        maxBytes > 0 &&
        maxBytes <= 104857600 &&
        Number.isSafeInteger(budget) &&
        budget >= maxBytes &&
        budget <= 10737418240,
      bucket,
      domain: domain.replace(/\/$/, ''),
      maxBytes,
      budget,
    }
  }
  private config() {
    const status = this.status()
    ensure(
      status.configured,
      503,
      'RESOURCE_STORAGE_NOT_CONFIGURED',
      '资料存储尚未配置，请在云函数配置七牛空间、密钥和 HTTPS 下载域名',
    )
    return {
      ...status,
      ak: process.env.QINIU_ACCESS_KEY!,
      sk: process.env.QINIU_SECRET_KEY!,
    }
  }
  private check(record: ResourceRecord) {
    const config = this.config()
    ensure(
      record.bucket === config.bucket,
      409,
      'RESOURCE_BUCKET_CHANGED',
      '资料所属空间与当前配置不同，请先恢复正确的存储配置',
    )
    ensure(
      /^electronicclub\/resources\/v1\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(
        record.key,
      ),
      400,
      'RESOURCE_KEY',
      '资料对象标识无效',
    )
    return config
  }
  ticket(record: ResourceRecord, now: number) {
    const c = this.check(record),
      url = process.env.QINIU_UPLOAD_URL ?? 'https://upload.qiniup.com'
    ensure(
      /^https:\/\/(?:upload|up)(?:-[a-z0-9-]+)?\.(?:qiniup\.com|qbox\.me)$/.test(
        url,
      ),
      503,
      'RESOURCE_UPLOAD_HOST',
      '七牛上传地址配置无效',
    )
    const policy = {
      scope: `${c.bucket}:${record.key}`,
      deadline: Math.floor(now / 1000) + 600,
      insertOnly: 1,
      fsizeMin: record.size,
      fsizeLimit: record.size,
      detectMime: 1,
      mimeLimit: [
        ...new Set([
          ...Object.values(RESOURCE_TYPES),
          'application/octet-stream',
          'application/x-zip-compressed',
          'application/x-ole-storage',
          'application/vnd.ms-office',
        ]),
      ].join(';'),
    }
    const encoded = safe64(JSON.stringify(policy))
    return {
      uploadUrl: url,
      token: `${c.ak}:${sign(encoded, c.sk)}:${encoded}`,
      key: record.key,
      expiresAt: new Date(now + 600000).toISOString(),
    }
  }
  private async management(
    record: ResourceRecord,
    operation: 'stat' | 'delete',
  ) {
    const c = this.check(record),
      path = `/${operation}/${safe64(c.bucket + ':' + record.key)}`
    let response: Response
    try {
      response = await this.send('https://rs.qiniu.com' + path, {
        method: 'POST',
        headers: {
          Authorization: `QBox ${c.ak}:${sign(path + '\n', c.sk)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: '',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new ApiError(
        502,
        'QINIU_UNREACHABLE',
        '暂时无法连接七牛云，请稍后重试',
      )
    }
    if (response.status === 612 || response.status === 404) {
      if (operation === 'delete') return null
      throw new ApiError(
        409,
        'RESOURCE_UPLOAD_MISSING',
        '七牛尚未查到该文件，请确认上传成功后重试',
      )
    }
    ensure(
      response.ok,
      502,
      'QINIU_REQUEST_FAILED',
      '七牛云请求失败，请检查密钥权限、空间和网络配置',
    )
    if (operation === 'delete') return null
    try {
      return (await response.json()) as {
        fsize: number
        mimeType: string
        hash: string
      }
    } catch {
      throw new ApiError(502, 'QINIU_INVALID_RESPONSE', '七牛文件校验响应无效')
    }
  }
  download(record: ResourceRecord) {
    const c = this.check(record)
    return (
      c.domain +
      '/' +
      record.key.split('/').map(encodeURIComponent).join('/') +
      '?attname=' +
      encodeURIComponent(record.originalName)
    )
  }
  async verify(record: ResourceRecord) {
    const info = await this.management(record, 'stat')
    ensure(
      info &&
        info.fsize === record.size &&
        typeof info.hash === 'string' &&
        info.hash.length >= 20 &&
        info.hash.length <= 100,
      409,
      'RESOURCE_SIZE_MISMATCH',
      '上传文件大小或校验信息不一致，请重新上传',
    )
    ensure(
      !/html|javascript|svg|executable/i.test(info.mimeType ?? ''),
      400,
      'RESOURCE_TYPE',
      '文件真实类型不符合资料库要求',
    )
    const c = this.check(record)
    const base =
      this.download(record) + '&e=' + Math.floor(Date.now() / 1000 + 120)
    const url = base + '&token=' + c.ak + ':' + sign(base, c.sk)
    let response: Response
    try {
      response = await this.send(url, {
        headers: { Range: 'bytes=0-8191' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new ApiError(
        502,
        'RESOURCE_READ_FAILED',
        '暂时无法读取七牛文件，请检查下载域名和 HTTPS 配置',
      )
    }
    ensure(
      response.ok && response.body,
      502,
      'RESOURCE_READ_FAILED',
      '无法校验文件内容，请检查下载域名和源站访问',
    )
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let length = 0
    try {
      while (length < 8192) {
        const part = await reader.read()
        if (part.done) break
        const take = part.value.subarray(0, 8192 - length)
        chunks.push(take)
        length += take.length
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const bytes = Buffer.concat(chunks.map((b) => Buffer.from(b)))
    validateFileHeader(record.originalName, bytes)
    return { hash: info.hash }
  }
  async remove(record: ResourceRecord) {
    await this.management(record, 'delete')
  }
}
export function validateFileHeader(name: string, bytes: Buffer) {
  const { ext } = fileType(name)
  let valid = false
  if (ext === 'pdf') valid = bytes.subarray(0, 5).toString() === '%PDF-'
  else if (['doc', 'xls', 'ppt'].includes(ext))
    valid = bytes
      .subarray(0, 8)
      .equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))
  else if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext))
    valid =
      bytes[0] === 80 &&
      bytes[1] === 75 &&
      ((bytes[2] === 3 && bytes[3] === 4) ||
        (ext === 'zip' && bytes[2] === 5 && bytes[3] === 6))
  else if (ext === '7z')
    valid = bytes
      .subarray(0, 6)
      .equals(Buffer.from([55, 122, 188, 175, 39, 28]))
  else {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
        stream: true,
      })
      valid =
        !bytes.includes(0) &&
        !/^\s*(?:<!doctype\s+html|<html|<script)/i.test(text)
    } catch {
      valid = false
    }
  }
  ensure(
    valid,
    400,
    'RESOURCE_FILE_SIGNATURE',
    '文件内容与所选格式不符，请选择真实有效的资料文件',
  )
}
