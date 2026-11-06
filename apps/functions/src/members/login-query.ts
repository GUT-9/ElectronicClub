import type { AuditLog, Member, LoginRecord } from '@electronic-club/shared'
import type { ListOptions } from './store'
import type { LoginMetadata } from './login-context'
export function validateLoginQuery(
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  if (
    Object.keys(filter).some(
      (k) => !['search', 'outcome', 'from', 'to'].includes(k),
    ) ||
    Object.values(filter).some((v) => typeof v !== 'string') ||
    String(filter.search ?? '').length > 80 ||
    !['all', 'success', 'failure', 'blocked'].includes(
      String(filter.outcome ?? 'all'),
    ) ||
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 50
  )
    throw new Error('INVALID_LOGIN_QUERY')
  for (const key of ['from', 'to'])
    if (filter[key] && !Number.isFinite(Date.parse(String(filter[key]))))
      throw new Error('INVALID_LOGIN_DATE')
}
const actor = `coalesce(nullif(a.data#>>'{login,memberUid}',''),CASE WHEN a.data->>'action'='auth.login' THEN a.data->>'actor' END)`
const concealed = `(u.data->>'anonymizedAt' IS NOT NULL)`
export const LOGIN_HISTORY_SQL = `WITH records AS (SELECT a.id,a.data->>'createdAt' AS at,
 jsonb_build_object('id',a.id,'createdAt',a.data->>'createdAt','memberUid',${actor},'name',coalesce(u.data->>'name',''),'studentId',coalesce(u.data->>'studentId',''),
 'outcome',CASE a.data->>'action' WHEN 'auth.login' THEN 'success' WHEN 'auth.login_blocked' THEN 'blocked' ELSE 'failure' END,
 'reason',coalesce(a.data#>>'{login,reason}',''),'ip',CASE WHEN ${concealed} THEN NULL ELSE a.data#>>'{login,ip}' END,
 'ipSource',CASE WHEN ${concealed} THEN 'unavailable' ELSE coalesce(a.data#>>'{login,ipSource}','legacy') END,
 'device',CASE WHEN ${concealed} THEN '' ELSE coalesce(a.data#>>'{login,device}','') END,'os',CASE WHEN ${concealed} THEN '' ELSE coalesce(a.data#>>'{login,os}','') END,
 'browser',CASE WHEN ${concealed} THEN '' ELSE coalesce(a.data#>>'{login,browser}','') END,'userAgent',CASE WHEN ${concealed} THEN '' ELSE coalesce(a.data#>>'{login,userAgent}','') END,
 'legacy',NOT(a.data ? 'login'),'anonymized',coalesce(${concealed},false)) AS record
 FROM electronicclub.audit_logs a LEFT JOIN electronicclub.users u ON u.id=${actor}
 WHERE a.data->>'action' IN ('auth.login','auth.login_failed','auth.login_blocked')
 AND (NOT $1::jsonb ? 'from' OR a.data->>'createdAt'>=$1::jsonb->>'from') AND (NOT $1::jsonb ? 'to' OR a.data->>'createdAt'<$1::jsonb->>'to')),
 filtered AS (SELECT * FROM records WHERE (coalesce($1::jsonb->>'outcome','all')='all' OR record->>'outcome'=$1::jsonb->>'outcome') AND strpos(lower(coalesce(record->>'name','')||' '||coalesce(record->>'studentId','')||' '||coalesce(record->>'ip','')),lower(coalesce($1::jsonb->>'search','')))>0),
 paged AS (SELECT * FROM filtered ORDER BY at DESC,id LIMIT $2 OFFSET $3)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(record ORDER BY at DESC,id) FROM paged),'[]'::jsonb)) AS result`
export function memoryLoginList<T>(
  data: Map<string, object>,
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  validateLoginQuery(filter, options)
  const rows: LoginRecord[] = []
  for (const [key, value] of data) {
    if (!key.startsWith('audit_logs/')) continue
    const a = value as AuditLog & { login?: LoginMetadata }
    if (
      !['auth.login', 'auth.login_failed', 'auth.login_blocked'].includes(
        a.action,
      )
    )
      continue
    if (
      (filter.from && a.createdAt < String(filter.from)) ||
      (filter.to && a.createdAt >= String(filter.to))
    )
      continue
    const memberUid =
        a.login?.memberUid ?? (a.action === 'auth.login' ? a.actor : null),
      u = memberUid
        ? (data.get('users/' + memberUid) as Member | undefined)
        : undefined,
      anonymized = !!u?.anonymizedAt
    const row: LoginRecord = {
      id: a.id,
      createdAt: a.createdAt,
      memberUid,
      name: u?.name ?? '',
      studentId: u?.studentId ?? '',
      outcome:
        a.action === 'auth.login'
          ? 'success'
          : a.action === 'auth.login_blocked'
            ? 'blocked'
            : 'failure',
      reason: a.login?.reason ?? '',
      ip: anonymized ? null : (a.login?.ip ?? null),
      ipSource: anonymized ? 'unavailable' : (a.login?.ipSource ?? 'legacy'),
      device: anonymized ? '' : (a.login?.device ?? ''),
      os: anonymized ? '' : (a.login?.os ?? ''),
      browser: anonymized ? '' : (a.login?.browser ?? ''),
      userAgent: anonymized ? '' : (a.login?.userAgent ?? ''),
      legacy: !a.login,
      anonymized,
    }
    if (
      filter.outcome &&
      filter.outcome !== 'all' &&
      filter.outcome !== row.outcome
    )
      continue
    if (
      ![row.name, row.studentId, row.ip ?? '']
        .join(' ')
        .toLowerCase()
        .includes(String(filter.search ?? '').toLowerCase())
    )
      continue
    rows.push(row)
  }
  rows.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  )
  return {
    total: rows.length,
    items: structuredClone(
      rows.slice(options.offset, options.offset + options.limit),
    ) as T[],
  }
}
