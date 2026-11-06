import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { Pool } from 'pg'
import { MemberService } from '../members/service'
import { PgStore } from '../members/pg-store'
import { createHandler } from '../index'
export function socketPool() {
  const host = process.env.PG_SOCKET_DIR ?? '/var/run/postgresql'
  if (!host.startsWith('/'))
    throw Error('Self-host PostgreSQL requires a Unix socket directory')
  return new Pool({
    host,
    user: 'service_role',
    database: process.env.PGDATABASE ?? 'electronicclub',
    password: readFileSync('/run/secrets/app_password', 'utf8').trim(),
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  })
}
export function trustedSource(
  address: string | undefined,
  headers: Record<string, string | undefined>,
  secret: string,
) {
  const supplied = Buffer.from(headers['x-eclub-proxy-token'] ?? ''),
    expected = Buffer.from(secret)
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected) &&
    isIP(headers['x-real-ip'] ?? '')
    ? headers['x-real-ip']
    : address
}
export function selfHostService() {
  return new MemberService(new PgStore(socketPool()))
}
export function startServer() {
  const pool = socketPool(),
    handler = createHandler(() => service),
    service = new MemberService(new PgStore(pool)),
    proxy = readFileSync('/run/secrets/proxy_token', 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(proxy)) throw Error('Invalid proxy secret')
  if (process.getuid?.() === 0) {
    process.setgid!(1000)
    process.setuid!(1000)
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/internal/ready') {
        await pool.query('SELECT 1 FROM electronicclub.users LIMIT 1')
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ready')
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 3100000) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(
            '{"success":false,"error":{"code":"PAYLOAD_TOO_LARGE","message":"请求内容过大"}}',
          )
          return
        }
        chunks.push(chunk)
      }
      const url = new URL(req.url ?? '/', 'http://localhost'),
        headers = Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value[0] : value,
          ]),
        )
      const sourceIp = trustedSource(req.socket.remoteAddress, headers, proxy)
      delete headers['x-eclub-proxy-token']
      const result = await handler({
        path: url.pathname,
        httpMethod: req.method,
        headers,
        body: Buffer.concat(chunks).toString('utf8'),
        queryStringParameters: Object.fromEntries(url.searchParams),
        requestContext: { sourceIp },
      })
      res.writeHead(result.statusCode, result.headers)
      res.end(
        result.isBase64Encoded
          ? Buffer.from(result.body, 'base64')
          : result.body,
      )
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(
        '{"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"服务暂不可用"}}',
      )
    }
  })
  server.requestTimeout = 65000
  server.headersTimeout = 10000
  server.maxHeadersCount = 64
  server.listen(3001, '0.0.0.0', () =>
    console.log('ElectronicClub self-host API ready on private port 3001'),
  )
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      server.close(() => {
        void pool.end()
      })
      setTimeout(() => server.closeAllConnections(), 15000).unref()
    })
}
