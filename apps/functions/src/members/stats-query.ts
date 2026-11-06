import type { Member, AuditLog } from '@electronic-club/shared'
export const MEMBER_STATS_SQL = `SELECT jsonb_build_object('activeMembers',count(*),'loggedInMembers',count(*) FILTER(WHERE has_login),'activatedMembers',count(*) FILTER(WHERE has_login AND has_password_change AND NOT must_change),'pendingMembers',count(*) FILTER(WHERE NOT(has_login AND has_password_change AND NOT must_change))) AS result FROM(SELECT u.id,coalesce((u.data->>'mustChangePassword')::boolean,true) AS must_change,EXISTS(SELECT 1 FROM electronicclub.audit_logs a WHERE a.data->>'actor'=u.id AND a.data->>'action'='auth.login') AS has_login,EXISTS(SELECT 1 FROM electronicclub.audit_logs a WHERE a.data->>'actor'=u.id AND a.data->>'action'='auth.password_change') AS has_password_change FROM electronicclub.users u WHERE u.data->>'status'='active' AND u.data->>'anonymizedAt' IS NULL) m`
export function memoryMemberStats(data: Map<string, object>) {
  const login = new Set<string>(),
    changed = new Set<string>()
  for (const [key, v] of data) {
    if (!key.startsWith('audit_logs/')) continue
    const a = v as AuditLog
    if (a.action === 'auth.login') login.add(a.actor)
    if (a.action === 'auth.password_change') changed.add(a.actor)
  }
  const users = [...data]
    .filter(([k]) => k.startsWith('users/'))
    .map(([, v]) => v as Member)
    .filter((u) => u.status === 'active' && !u.anonymizedAt)
  const activatedMembers = users.filter(
    (u) => !u.mustChangePassword && login.has(u.uid) && changed.has(u.uid),
  ).length
  return {
    activeMembers: users.length,
    loggedInMembers: users.filter((u) => login.has(u.uid)).length,
    activatedMembers,
    pendingMembers: users.length - activatedMembers,
  }
}
