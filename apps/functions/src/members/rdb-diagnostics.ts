import type { DatabaseDiagnostic } from './pg-store'

// Preserve only recognized error identifiers, never message/details/hint or raw payload.
const providerCodes = new Set([
  'INVALID_PATH',
  'INVALID_ENV',
  'INVALID_ENV_ID',
  'ENV_NOT_FOUND',
  'RESOURCE_NOT_FOUND',
  'DATABASE_NOT_INITIALIZED',
  'DATABASE_NOT_FOUND',
  'PERMISSION_DENIED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'INTERNAL_SERVER_ERROR',
  'FAILED_OPERATION',
  'ACCESS_TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'FailedOperation',
  'InvalidParameter',
  'InvalidParameterValue',
  'ResourceNotFound',
  'UnauthorizedOperation',
  'AuthFailure',
  'InternalError',
  'OperationDenied',
  'ServiceUnavailable',
])
const sqlStates = new Set([
  '42501',
  '42P01',
  '42883',
  '3F000',
  '23505',
  '23503',
  '23514',
  '23502',
  '40001',
  '40P01',
  '53300',
  '53400',
  '57014',
  '55P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08P01',
  'XX000',
  'P0001',
])
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
function safeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return providerCodes.has(value) ||
    sqlStates.has(value) ||
    /^PGRST\d{3}$/.test(value)
    ? value
    : undefined
}
function safeId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
      value,
    )
    ? value
    : undefined
}
export async function rdbDiagnostic(
  response: Response,
  operation: string,
): Promise<DatabaseDiagnostic> {
  let body: Record<string, unknown> = {}
  try {
    body = record(await response.json())
  } catch {
    /* Never log a raw error page. */
  }
  const wrapper = record(body.Response)
  const nested = record(body.error)
  const error = record(wrapper.Error)
  const code = [body.code, nested.code, error.Code, body.errorCode]
    .map(safeCode)
    .find(Boolean)
  const requestId = [
    response.headers.get('x-request-id'),
    response.headers.get('x-tcb-request-id'),
    response.headers.get('x-cloudbase-request-id'),
    body.requestId,
    body.request_id,
    body.reqId,
    body.RequestId,
    wrapper.RequestId,
  ]
    .map(safeId)
    .find(Boolean)
  const contentType = response.headers.get('content-type') ?? ''
  return {
    upstreamStatus: response.status,
    upstreamCode: code ?? 'UNRECOGNIZED',
    upstreamRequestId: requestId,
    operation: ['ec_read', 'ec_list', 'ec_commit'].includes(operation)
      ? operation
      : 'unknown',
    responseKind: contentType.includes('json')
      ? 'json'
      : contentType.includes('html')
        ? 'html'
        : 'other',
  }
}
export function rdbFailureCode(diagnostic: DatabaseDiagnostic): string {
  const code = diagnostic.upstreamCode
  if (
    [401, 403].includes(diagnostic.upstreamStatus!) ||
    [
      '42501',
      'PGRST301',
      'PERMISSION_DENIED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'AuthFailure',
      'UnauthorizedOperation',
      'ACCESS_TOKEN_INVALID',
      'TOKEN_EXPIRED',
    ].includes(code!)
  )
    return 'RDB_HTTP_PERMISSION_DENIED'
  if (['PGRST202', '42883'].includes(code!)) return 'RDB_RPC_NOT_INSTALLED'
  if (['42P01', '3F000', 'PGRST205'].includes(code!))
    return 'RDB_SCHEMA_NOT_INSTALLED'
  if (code === 'PGRST106') return 'RDB_SCHEMA_NOT_EXPOSED'
  if (code === 'INVALID_PATH') return 'RDB_ENDPOINT_NOT_AVAILABLE'
  if (['PGRST000', 'PGRST001'].includes(code!))
    return 'RDB_DATABASE_UNAVAILABLE'
  return 'RDB_HTTP_FAILED'
}
