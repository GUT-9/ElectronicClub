import type { ListOptions } from './store'
export function validateAccessQuery(
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  const keys = ['roleId', 'permissionId', 'search', 'status']
  if (
    Object.keys(filter).some((k) => !keys.includes(k)) ||
    Object.values(filter).some((v) => typeof v !== 'string') ||
    Number(!!filter.roleId) + Number(!!filter.permissionId) !== 1 ||
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 50 ||
    !['active', 'disabled', 'deleted', 'all'].includes(
      String(filter.status ?? 'active'),
    ) ||
    String(filter.search ?? '').length > 80
  )
    throw new Error('INVALID_ACCESS_QUERY')
}
const matches = `(($1::jsonb ? 'roleId' AND r.id=$1::jsonb->>'roleId') OR ($1::jsonb ? 'permissionId' AND (r.data->>'super'='true' OR r.data->'permissionIds' @> jsonb_build_array($1::jsonb->>'permissionId'))))`
const roleSummary = `jsonb_build_object('id',r.id,'name',r.data->>'name','super',coalesce((r.data->>'super')::boolean,false))`
export const ACCESS_SQL = `WITH filtered AS (SELECT u.id,u.data FROM electronicclub.users u WHERE u.data->>'status' IN ('active','disabled','deleted') AND (coalesce($1::jsonb->>'status','active')='all' OR u.data->>'status'=coalesce($1::jsonb->>'status','active')) AND (NOT $1::jsonb ? 'search' OR strpos(upper(coalesce(u.data->>'studentId','')||' '||coalesce(u.data->>'name','')||' '||coalesce(u.data->>'nickname','')),upper($1::jsonb->>'search'))>0) AND EXISTS(SELECT 1 FROM electronicclub.user_roles ur JOIN electronicclub.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND ${matches})),paged AS (SELECT id,data FROM filtered ORDER BY data->>'studentId',id LIMIT $2 OFFSET $3) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(jsonb_build_object('uid',p.id,'studentId',p.data->>'studentId','name',p.data->>'name','nickname',p.data->>'nickname','status',p.data->>'status','roleIds',p.data->'roleIds','roles',coalesce((SELECT jsonb_agg(${roleSummary} ORDER BY r.data->>'name',r.id) FROM electronicclub.user_roles ur JOIN electronicclub.roles r ON r.id=ur.role_id WHERE ur.user_id=p.id),'[]'::jsonb),'sources',coalesce((SELECT jsonb_agg(${roleSummary} ORDER BY r.data->>'name',r.id) FROM electronicclub.user_roles ur JOIN electronicclub.roles r ON r.id=ur.role_id WHERE ur.user_id=p.id AND ${matches}),'[]'::jsonb)) ORDER BY p.data->>'studentId',p.id) FROM paged p),'[]'::jsonb)) AS result`
export function memoryAccessList<T>(
  data: Map<string, object>,
  filter: Record<string, unknown>,
  options: ListOptions,
) {
  validateAccessQuery(filter, options)
  const users = [...data]
    .filter(([k]) => k.startsWith('users/'))
    .map(
      ([k, v]) =>
        ({ ...v, uid: k.slice(6) }) as {
          uid: string
          studentId: string
          name: string
          nickname: string
          status: string
          roleIds: string[]
        },
    )
  const rows = users
    .filter(
      (u) =>
        filter.status === 'all' || u.status === (filter.status ?? 'active'),
    )
    .filter((u) =>
      [u.studentId, u.name, u.nickname]
        .join(' ')
        .toUpperCase()
        .includes(String(filter.search ?? '').toUpperCase()),
    )
    .map((u) => {
      const roles = u.roleIds.map(
        (id) =>
          ({ ...(data.get('roles/' + id) ?? {}), id }) as {
            id: string
            name: string
            super: boolean
            permissionIds: string[]
          },
      )
      const sources = roles.filter((r) =>
        filter.roleId
          ? r.id === filter.roleId
          : r.super || r.permissionIds.includes(String(filter.permissionId)),
      )
      const minimal = (r: (typeof roles)[number]) => ({
        id: r.id,
        name: r.name,
        super: !!r.super,
      })
      return {
        uid: u.uid,
        studentId: u.studentId,
        name: u.name,
        nickname: u.nickname,
        status: u.status,
        roleIds: u.roleIds,
        roles: roles.map(minimal),
        sources: sources.map(minimal),
      }
    })
    .filter((u) => u.sources.length > 0)
    .sort(
      (a, b) =>
        a.studentId.localeCompare(b.studentId, 'en') ||
        a.uid.localeCompare(b.uid),
    )
  return {
    total: rows.length,
    items: structuredClone(
      rows.slice(options.offset, options.offset + options.limit),
    ) as T[],
  }
}
