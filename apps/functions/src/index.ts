import { loginContext } from './members/login-context'
import { sessionCookie, sessionCookieConfig } from './members/cookie'
import { randomUUID } from 'node:crypto'
import {
  BACKEND_BODY_REVISION,
  HttpBodyError,
  parseHttpBody,
} from './http-body'
import { DatabaseFailure } from './members/pg-store'
import { ZodError } from 'zod'
import { ApiError } from './members/model'
import type { MemberService } from './members/service'
import { getService } from './runtime'
import type { ImportJob, Member, Page } from '@electronic-club/shared'
import { exportWorkbook, templateWorkbook } from './members/xlsx'
export interface HttpEvent {
  path?: string
  httpMethod?: string
  headers?: Record<string, string | undefined>
  body?: unknown
  isBase64Encoded?: boolean | string
  queryStringParameters?: Record<string, string>
  requestContext?: {
    sourceIp?: string
    http?: { sourceIp?: string }
    identity?: { sourceIp?: string }
  }
}
export interface HttpResult {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded?: boolean
}
export function createHandler(resolveService: () => MemberService) {
  return async (event: HttpEvent): Promise<HttpResult> => {
    const requestId = randomUUID()
    const headers: Record<string, string> = {
      'X-Request-ID': requestId,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'X-EClub-Backend-Revision': BACKEND_BODY_REVISION,
      'X-EClub-Data-Revision': 'db-efficiency-v1',
    }
    const requestHeaders = Object.fromEntries(
      Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    )
    const origin = requestHeaders.origin
    const allowed = process.env.ALLOWED_ORIGIN
    if (allowed && origin === allowed) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Credentials'] = 'true'
      headers['Access-Control-Allow-Methods'] =
        'GET, POST, PATCH, PUT, DELETE, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Requested-With'
    }
    const respond = (statusCode: number, body: unknown): HttpResult => ({
      statusCode,
      headers,
      body: JSON.stringify(body),
    })
    const rawPath = (event.path ?? '').split('?')[0]!
    const path = rawPath.startsWith('/api/')
      ? rawPath
      : '/api' + (rawPath.startsWith('/') ? rawPath : '/' + rawPath)
    const method = event.httpMethod ?? 'GET'
    if (method === 'OPTIONS') return { statusCode: 204, headers, body: '' }
    if (path === '/api/health') {
      if (method !== 'GET')
        return respond(405, {
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET' },
        })
      return respond(200, {
        success: true,
        data: {
          status: 'ok',
          service: 'ElectronicClub API',
          timestamp: new Date().toISOString(),
        },
      })
    }
    // Unknown public routes preserve 404 without forcing database initialization.
    if (
      !/^\/api\/(auth|profile|members|roles|permissions|imports|audit|public|events|articles|popups|forum|media|login-history|resources)(?:\/|$)/.test(
        path,
      )
    )
      return respond(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: '接口不存在' },
      })
    try {
      if (method !== 'GET') {
        if (
          !allowed ||
          origin !== allowed ||
          requestHeaders['x-requested-with'] !== 'ElectronicClub'
        )
          throw new ApiError(403, 'CSRF_REJECTED', '请求来源校验失败')
        if (
          !(requestHeaders['content-type'] ?? '').startsWith('application/json')
        )
          throw new ApiError(415, 'CONTENT_TYPE', '请使用application/json')
      }
      const input = parseHttpBody(
        event,
        /^\/api\/(forum|media|resources)(?:\/|$)/.test(path)
          ? 65536
          : 3_100_000,
      )
      const cookieName = sessionCookieConfig().name
      const token =
        (requestHeaders.cookie ?? '')
          .split(';')
          .map((x) => x.trim())
          .find((x) => x.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1) ?? ''
      if (
        !token &&
        !(path === '/api/auth/login' && method === 'POST') &&
        !(
          method === 'GET' &&
          (path.startsWith('/api/media/') ||
            /^\/api\/resources(?:\/[a-f0-9-]{36}\/download)?$/.test(path) ||
            path.startsWith('/api/public/') ||
            /^\/api\/forum\/(boards|posts|images)(?:\/|$)/.test(path))
        )
      )
        throw new ApiError(401, 'UNAUTHENTICATED', '请先登录')
      const service = resolveService()
      if (path === '/api/imports/template' && method === 'GET') {
        await service.authorize(token, 'members.import')
        headers['Content-Type'] =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        headers['Content-Disposition'] =
          'attachment; filename="members-template.xlsx"'
        return {
          statusCode: 200,
          headers,
          body: (await templateWorkbook()).toString('base64'),
          isBase64Encoded: true,
        }
      }
      if (
        method === 'GET' &&
        (path === '/api/members/export.xlsx' ||
          /^\/api\/imports\/[a-f0-9]{64}\/errors.xlsx$/.test(path))
      ) {
        let binary: Buffer
        if (path === '/api/members/export.xlsx') {
          const result = await service.execute(
            token,
            'GET',
            '/api/members/export',
            {},
            event.queryStringParameters ?? {},
          )
          const page = result.data as Page<Member>
          binary = await exportWorkbook(
            [
              '学号',
              '姓名',
              '昵称',
              '性别',
              '学院',
              '专业',
              '班级',
              '年级',
              '手机号',
              '邮箱',
              '状态',
            ],
            page.items.map((m) => [
              m.studentId,
              m.name,
              m.nickname,
              m.gender,
              m.college,
              m.major,
              m.className,
              m.grade,
              m.phone,
              m.email,
              m.status,
            ]),
          )
        } else {
          const result = await service.execute(
            token,
            'GET',
            path.replace('/errors.xlsx', ''),
            {},
            {},
          )
          const job = result.data as ImportJob
          binary = await exportWorkbook(
            [
              '原行号',
              '学号',
              '姓名',
              '性别',
              '学院',
              '专业',
              '班级',
              '年级',
              '错误',
            ],
            job.rows
              .filter((row) => row.error)
              .map((row) => [
                String(row.line),
                row.member?.studentId ?? '',
                row.member?.name ?? '',
                row.member?.gender ?? '',
                row.member?.college ?? '',
                row.member?.major ?? '',
                row.member?.className ?? '',
                row.member?.grade ?? '',
                row.error ?? '',
              ]),
          )
        }
        headers['Content-Type'] =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        headers['Content-Disposition'] = 'attachment; filename="export.xlsx"'
        return {
          statusCode: 200,
          headers,
          body: binary.toString('base64'),
          isBase64Encoded: true,
        }
      }
      const result =
        path === '/api/auth/login' && method === 'POST'
          ? await service.login(
              input,
              loginContext(event.requestContext, requestHeaders),
            )
          : await service.execute(
              token,
              method,
              path,
              input,
              event.queryStringParameters ?? {},
            )
      if (result.binary && result.contentType?.startsWith('image/')) {
        headers['Content-Type'] = result.contentType
        headers['Content-Disposition'] = 'inline'
        return {
          statusCode: 200,
          headers,
          body: result.binary.toString('base64'),
          isBase64Encoded: true,
        }
      }
      if (result.binary) {
        headers['Content-Type'] =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        headers['Content-Disposition'] =
          `attachment; filename="registrations.xlsx"; filename*=UTF-8''${encodeURIComponent(result.filename ?? 'registrations.xlsx')}`
        return {
          statusCode: 200,
          headers,
          body: result.binary.toString('base64'),
          isBase64Encoded: true,
        }
      }
      if (result.token || result.clearCookie) {
        headers['Set-Cookie'] = sessionCookie(
          result.token ?? '',
          Boolean(result.clearCookie),
        )
      }
      return result.error
        ? respond(result.status ?? 400, { success: false, error: result.error })
        : respond(200, { success: true, data: result.data })
    } catch (error) {
      if (error instanceof HttpBodyError) {
        headers['X-EClub-Body-Error'] = error.diagnostic.stage
        console.error(
          JSON.stringify({
            requestId,
            category: 'transport',
            revision: BACKEND_BODY_REVISION,
            code: error.code,
            ...error.diagnostic,
          }),
        )
      }
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        path === '/api/auth/logout'
      ) {
        headers['Set-Cookie'] = sessionCookie('', true)
        return respond(200, { success: true, data: { ok: true } })
      }
      if (error instanceof ApiError)
        return respond(error.status, {
          success: false,
          error: { code: error.code, message: error.message },
        })
      if (error instanceof ZodError)
        return respond(400, {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: error.issues
              .map((x) => `${x.path.join('.')}: ${x.message}`)
              .join('；'),
          },
        })
      console.error(
        JSON.stringify({
          requestId,
          ...(error instanceof DatabaseFailure ? error.diagnostic : undefined),
          category: error instanceof DatabaseFailure ? 'database' : 'internal',
          stage: error instanceof DatabaseFailure ? error.stage : 'request',
          code:
            error instanceof DatabaseFailure
              ? error.safeCode
              : 'INTERNAL_FAILURE',
        }),
      )
      // Never log request bodies, cookies, passwords or full SDK errors.
      return respond(503, {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '服务暂不可用，请检查部署配置或稍后重试',
        },
      })
    }
  }
}
export const main = createHandler(getService)
