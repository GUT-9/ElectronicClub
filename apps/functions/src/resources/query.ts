import type { ListOptions } from '../members/store'
import type { ResourceRecord } from './model'
export function validateResourceQuery(
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  if (
    Object.keys(filter).some(
      (k) =>
        ![
          'public',
          'status',
          'search',
          'category',
          'cleanupBefore',
          'uploadBefore',
        ].includes(k),
    ) ||
    Object.values(filter).some(
      (v) => typeof v !== 'string' && typeof v !== 'boolean',
    ) ||
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 50 ||
    String(filter.search ?? '').length > 80 ||
    String(filter.category ?? '').length > 40 ||
    (filter.status &&
      ![
        'uploading',
        'draft',
        'published',
        'deleting',
        'deleted',
        'all',
      ].includes(String(filter.status)))
  )
    throw new Error('INVALID_RESOURCE_QUERY')
}
export const RESOURCE_SQL = `WITH filtered AS (SELECT id,data FROM electronicclub.club_resources WHERE (NOT coalesce(($1::jsonb->>'public')::boolean,false) OR data->>'status'='published') AND (NOT $1::jsonb ? 'status' OR $1::jsonb->>'status'='all' OR data->>'status'=$1::jsonb->>'status') AND ($1::jsonb ? 'status' OR data->>'status'<>'deleted') AND (coalesce($1::jsonb->>'category','')='' OR data->>'category'=$1::jsonb->>'category') AND strpos(lower(coalesce(data->>'title','')||' '||coalesce(data->>'description','')||' '||coalesce(data->>'originalName','')),lower(coalesce($1::jsonb->>'search','')))>0 AND (NOT $1::jsonb ? 'cleanupBefore' OR ((data->>'status'='deleting' AND data->>'expiresAt'<$1::jsonb->>'cleanupBefore') OR (data->>'status'='uploading' AND data->>'createdAt'<coalesce($1::jsonb->>'uploadBefore',$1::jsonb->>'cleanupBefore'))))),paged AS (SELECT id,data FROM filtered ORDER BY data->>'createdAt' DESC,id LIMIT $2 OFFSET $3) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(data ORDER BY data->>'createdAt' DESC,id) FROM paged),'[]'::jsonb)) AS result`
export function memoryResourceList<T>(
  data: Map<string, object>,
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  validateResourceQuery(filter, options)
  const rows = [...data]
    .filter(([k]) => k.startsWith('club_resources/'))
    .map(([, v]) => v as ResourceRecord)
    .filter((r) => !filter.public || r.status === 'published')
    .filter((r) =>
      filter.status
        ? filter.status === 'all' || r.status === filter.status
        : r.status !== 'deleted',
    )
    .filter((r) => !filter.category || r.category === filter.category)
    .filter((r) =>
      [r.title, r.description, r.originalName]
        .join(' ')
        .toLowerCase()
        .includes(String(filter.search ?? '').toLowerCase()),
    )
    .filter(
      (r) =>
        !filter.cleanupBefore ||
        (r.status === 'deleting' &&
          r.expiresAt < String(filter.cleanupBefore)) ||
        (r.status === 'uploading' &&
          r.createdAt < String(filter.uploadBefore ?? filter.cleanupBefore)),
    )
    .sort(
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
