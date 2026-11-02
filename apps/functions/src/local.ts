import { createServer } from 'node:http'
import { main, createHandler } from './index'
import { MemberService } from './members/service'
import { MemoryStore } from './members/memory-store'
async function start() {
  let handler = main
  if (process.env.MEMBER_STORE === 'memory') {
    const service = new MemberService(new MemoryStore())
    if (process.env.LOCAL_ADMIN_STUDENT_ID && process.env.LOCAL_ADMIN_PASSWORD)
      await service.bootstrap(
        {
          studentId: process.env.LOCAL_ADMIN_STUDENT_ID,
          name: '本地开发管理员',
        },
        process.env.LOCAL_ADMIN_PASSWORD,
      )
    handler = createHandler(() => service)
    console.log('Explicit memory adapter: ephemeral local development only')
  }
  const port = Number(process.env.PORT ?? 3001)
  createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 3_100_000) {
          response.writeHead(413)
          response.end()
          return
        }
        chunks.push(chunk)
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const result = await handler({
        path: url.pathname,
        httpMethod: request.method,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v[0] : v,
          ]),
        ),
        queryStringParameters: Object.fromEntries(url.searchParams),
        requestContext: { sourceIp: request.socket.remoteAddress },
      })
      response.writeHead(result.statusCode, result.headers)
      response.end(
        result.isBase64Encoded
          ? Buffer.from(result.body, 'base64')
          : result.body,
      )
    } catch {
      response.writeHead(500)
      response.end('Internal error')
    }
  }).listen(port, '0.0.0.0', () =>
    console.log(`ElectronicClub API listening on port ${port}`),
  )
}
void start()
