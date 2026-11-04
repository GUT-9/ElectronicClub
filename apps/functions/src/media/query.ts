import type { ListOptions } from '../members/store'
export function validateExpired(
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  if (
    Object.keys(filter).length !== 1 ||
    typeof filter.before !== 'string' ||
    !Number.isFinite(Date.parse(filter.before)) ||
    options.offset !== 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 50
  )
    throw new Error('INVALID_MEDIA_CLEANUP_QUERY')
}
export const EXPIRED_MEDIA_SQL = `WITH selected AS (SELECT id,data FROM electronicclub.media_images WHERE data->'bindings'='[]'::jsonb AND data->>'createdAt'<$1 ORDER BY data->>'createdAt',id LIMIT $2) SELECT jsonb_build_object('total',(SELECT count(*) FROM selected),'items',coalesce((SELECT jsonb_agg(data ORDER BY data->>'createdAt',id) FROM selected),'[]'::jsonb)) AS result`
