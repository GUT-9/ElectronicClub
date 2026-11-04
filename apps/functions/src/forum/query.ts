import type { ListOptions } from '../members/store'
export const FORUM_TABLES = [
  'forum_boards',
  'forum_posts',
  'forum_comments',
  'forum_likes',
  'forum_favorites',
  'forum_reports',
  'forum_user_restrictions',
  'forum_notifications',
  'forum_images',
] as const
const queryTables: readonly string[] = [...FORUM_TABLES, 'audit_logs']
const keys = [
  '_createdBefore',
  '_beforeFloor',
  '_forumAudit',
  'status',
  'boardId',
  'postId',
  'authorUid',
  'recipientUid',
  'reporterUid',
  'ownerUid',
  'uid',
  'read',
  '_search',
  '_sort',
  '_public',
  '_favoriteUid',
  '_featured',
  '_notDeleted',
]
export function validateForumQuery(
  collection: string,
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  if (
    !queryTables.includes(collection) ||
    Object.keys(filter).some((k) => !keys.includes(k)) ||
    Object.values(filter).some(
      (v) => !['string', 'boolean'].includes(typeof v),
    ) ||
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 50
  )
    throw new Error('INVALID_FORUM_QUERY')
  if (collection === 'audit_logs' && filter._forumAudit !== true)
    throw new Error('INVALID_FORUM_AUDIT')
  if (filter._beforeFloor && !/^\d{1,9}$/.test(String(filter._beforeFloor)))
    throw new Error('INVALID_FLOOR')
  if (
    filter._sort &&
    !['latest', 'reply', 'hot', 'oldest', 'featured'].includes(
      String(filter._sort),
    )
  )
    throw new Error('INVALID_FORUM_SORT')
}
// Fixed SQL and parameterized JSON values. Shared by native PG and generated RPC.
export function forumSelect(collection: string) {
  if (!queryTables.includes(collection)) throw new Error('INVALID_FORUM_TABLE')
  const publicCheck =
    collection === 'forum_boards'
      ? `r.data->>'status' IN ('active','disabled')`
      : collection === 'forum_posts'
        ? `r.data->>'status'='published' AND EXISTS(SELECT 1 FROM electronicclub.forum_boards b WHERE b.id=r.data->>'boardId' AND b.data->>'status' IN ('active','disabled'))`
        : collection === 'forum_comments'
          ? `r.data->>'status' IN ('published','deleted') AND EXISTS(SELECT 1 FROM electronicclub.forum_posts p JOIN electronicclub.forum_boards b ON b.id=p.data->>'boardId' WHERE p.id=r.data->>'postId' AND p.data->>'status'='published' AND b.data->>'status' IN ('active','disabled'))`
          : 'false'
  const filters = [
    'status',
    'boardId',
    'postId',
    'authorUid',
    'recipientUid',
    'reporterUid',
    'ownerUid',
    'uid',
    'read',
  ]
    .map(
      (k) => `(NOT $1::jsonb ? '${k}' OR r.data->>'${k}'=$1::jsonb->>'${k}')`,
    )
    .join(' AND ')
  const favorites =
    collection === 'forum_posts'
      ? `EXISTS(SELECT 1 FROM electronicclub.forum_favorites f WHERE f.data->>'postId'=r.id AND f.data->>'uid'=$1::jsonb->>'_favoriteUid')`
      : 'false'
  const order =
    collection === 'forum_boards'
      ? `(data->>'position')::integer,id`
      : collection === 'forum_comments'
        ? `(data->>'floor')::integer,id`
        : collection === 'forum_posts'
          ? `coalesce((data->>'pinned')::boolean,false) DESC,CASE WHEN $1::jsonb->>'_sort'='hot' THEN coalesce((data->>'likeCount')::integer,0)*3+coalesce((data->>'commentCount')::integer,0)*2 END DESC NULLS LAST,CASE WHEN $1::jsonb->>'_sort'='reply' THEN data->>'lastReplyAt' ELSE data->>'createdAt' END DESC,id`
          : `data->>'createdAt' DESC,id`
  const projection =
    collection === 'forum_images' ? "r.data - 'dataUrl' AS data" : 'r.data'
  return `WITH filtered AS (SELECT r.id,${projection} FROM electronicclub.${collection} r WHERE ${collection === 'audit_logs' ? "r.data->>'action' LIKE 'forum.%' AND" : ''} ${filters} AND (NOT $1::jsonb ? '_notDeleted' OR r.data->>'status'<>'deleted') AND (NOT $1::jsonb ? '_public' OR (${publicCheck})) AND (NOT $1::jsonb ? '_favoriteUid' OR (${favorites})) AND (NOT $1::jsonb ? '_featured' OR r.data->>'featured'='true') AND (NOT $1::jsonb ? '_createdBefore' OR (r.data->>'createdAt')::timestamptz<($1::jsonb->>'_createdBefore')::timestamptz) AND (NOT $1::jsonb ? '_beforeFloor' OR (r.data->>'floor')::integer<($1::jsonb->>'_beforeFloor')::integer) AND (NOT $1::jsonb ? '_search' OR strpos(lower(coalesce(r.data->>'title','')||' '||coalesce(r.data->>'body','')||' '||coalesce(r.data->>'name','')),lower($1::jsonb->>'_search'))>0)),paged AS (SELECT id,data,row_number() OVER(ORDER BY ${order}) AS n FROM filtered ORDER BY ${order} LIMIT $2 OFFSET $3) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id) ORDER BY n) FROM paged),'[]'::jsonb)) AS result`
}
