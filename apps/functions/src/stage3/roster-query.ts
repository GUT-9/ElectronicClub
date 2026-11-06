import type { EventRosterSummary, Registration } from '@electronic-club/shared'
import type { ListOptions } from '../members/store'
export function validateRosterQuery(
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  if (
    !/^[a-f0-9-]{36}$/i.test(String(filter.eventId ?? '')) ||
    Object.keys(filter).some(
      (k) =>
        ![
          'eventId',
          'search',
          'college',
          'className',
          'status',
          'checkedIn',
        ].includes(k),
    ) ||
    Object.values(filter).some(
      (v) => typeof v !== 'string' || v.length > 100,
    ) ||
    !['', 'pending', 'approved', 'rejected', 'cancelled', 'manual'].includes(
      String(filter.status ?? ''),
    ) ||
    !['', 'yes', 'no'].includes(String(filter.checkedIn ?? '')) ||
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 100
  )
    throw new Error('INVALID_ROSTER_QUERY')
}
export const EVENT_ROSTER_SQL = `WITH filtered AS (SELECT id,data FROM electronicclub.registrations WHERE event_id=$1::jsonb->>'eventId'
AND (coalesce($1::jsonb->>'status','')='' OR data->>'status'=$1::jsonb->>'status')
AND (coalesce($1::jsonb->>'college','')='' OR data#>>'{snapshot,college}'=$1::jsonb->>'college')
AND (coalesce($1::jsonb->>'className','')='' OR data#>>'{snapshot,className}'=$1::jsonb->>'className')
AND (coalesce($1::jsonb->>'checkedIn','')='' OR CASE WHEN $1::jsonb->>'checkedIn'='yes' THEN coalesce(data->>'checkedInAt','')<>'' ELSE coalesce(data->>'checkedInAt','')='' END)
AND strpos(upper(coalesce(data#>>'{snapshot,studentId}','')||' '||coalesce(data#>>'{snapshot,name}','')),upper(coalesce($1::jsonb->>'search','')))>0),
paged AS (SELECT id,data FROM filtered ORDER BY data->>'registeredAt' DESC,id LIMIT $2 OFFSET $3)
SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(data ORDER BY data->>'registeredAt' DESC,id) FROM paged),'[]'::jsonb),
'summary',jsonb_build_object('checkedIn',(SELECT count(*) FROM filtered WHERE coalesce(data->>'checkedInAt','')<>''),'notCheckedIn',(SELECT count(*) FROM filtered WHERE coalesce(data->>'checkedInAt','')=''),'pending',(SELECT count(*) FROM filtered WHERE data->>'status'='pending'))) AS result`
export interface RosterResult {
  items: Registration[]
  total: number
  summary: EventRosterSummary
}
export function memoryRoster(
  data: Map<string, object>,
  filter: Record<string, unknown>,
  options: ListOptions,
): RosterResult {
  validateRosterQuery(filter, options)
  const rows = [...data]
    .filter(([k]) => k.startsWith('registrations/'))
    .map(([, value]) => value as Registration)
    .filter(
      (r) =>
        r.eventId === filter.eventId &&
        (!filter.status || r.status === filter.status) &&
        (!filter.college || r.snapshot.college === filter.college) &&
        (!filter.className || r.snapshot.className === filter.className) &&
        (!filter.checkedIn ||
          (filter.checkedIn === 'yes' ? !!r.checkedInAt : !r.checkedInAt)) &&
        `${r.snapshot.studentId} ${r.snapshot.name}`
          .toUpperCase()
          .includes(String(filter.search ?? '').toUpperCase()),
    )
    .sort(
      (a, b) =>
        b.registeredAt.localeCompare(a.registeredAt) ||
        a.id.localeCompare(b.id),
    )
  return {
    items: structuredClone(
      rows.slice(options.offset, options.offset + options.limit),
    ),
    total: rows.length,
    summary: {
      checkedIn: rows.filter((r) => r.checkedInAt).length,
      notCheckedIn: rows.filter((r) => !r.checkedInAt).length,
      pending: rows.filter((r) => r.status === 'pending').length,
    },
  }
}
