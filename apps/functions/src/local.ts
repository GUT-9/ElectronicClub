import { createServer } from 'node:http'
import { main } from './index'
const port = Number(process.env.PORT ?? 3001)
createServer(async (request, response) => {
  try {
    const result = await main({ path: new URL(request.url ?? '/', 'http://localhost').pathname, httpMethod: request.method, headers: { origin: request.headers.origin } })
    response.writeHead(result.statusCode, result.headers)
    response.end(result.body)
  } catch {
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: '服务内部错误' } }))
  }
}).listen(port, '0.0.0.0', () => console.log(`ElectronicClub API listening on port ${port}`))
