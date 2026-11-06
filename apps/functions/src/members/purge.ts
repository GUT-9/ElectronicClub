import type { ImportJob, Member } from '@electronic-club/shared'
import { ApiError } from './model'

// JSON references without foreign keys also count as business history.
// Keep the explicit test adapter aligned with the generated SQL; production
// additionally inspects every foreign key to users, including future tables.
export const MEMBER_BUSINESS_FIELDS: Record<string, string[]> = {
  events: ['publisherUid', 'managerIds'],
  articles: ['publisherUid'],
  registrations: ['uid', 'reviewedBy'],
  checkins: ['uid', 'actor'],
  event_managers: ['uid'],
  import_jobs: ['owner'],
  forum_posts: ['authorUid'],
  forum_comments: ['authorUid'],
  forum_likes: ['uid'],
  forum_favorites: ['uid'],
  forum_reports: ['reporterUid'],
  forum_user_restrictions: ['uid'],
  forum_notifications: ['recipientUid'],
  forum_images: ['ownerUid'],
  media_images: ['ownerUid'],
  club_resources: ['ownerUid'],
}
export function purgeDatabaseError(code: unknown): ApiError | undefined {
  if (code === 'P1401')
    return new ApiError(
      409,
      'MEMBER_HAS_HISTORY',
      '成员存在帖子、活动、资料或其他业务关联，不能彻底删除，请使用匿名化',
    )
  if (code === 'P1402')
    return new ApiError(
      409,
      'PURGE_NOT_ALLOWED',
      '仅可彻底删除已软删除的非超级管理员账号',
    )
  if (code === 'P1403')
    return new ApiError(
      409,
      'PRIVACY_CLEANUP_PENDING',
      '该成员的隐私清理尚未完成，请先完成清理任务',
    )
}

// Explicit local/test adapter for the 014 trigger. Never used in production.
export function purgeMemoryMember(data: Map<string, object>, member: Member) {
  const fail = (code: string): never => {
    throw purgeDatabaseError(code)!
  }
  if (
    member.status !== 'deleted' ||
    member.roleIds.some(
      (id) => (data.get('roles/' + id) as { super?: boolean })?.super,
    )
  )
    fail('P1402')
  const uid = member.uid
  for (const [key, value] of data) {
    const table = key.split('/')[0]
    const record = value as Record<string, unknown>
    if (
      MEMBER_BUSINESS_FIELDS[table]?.some(
        (field) =>
          record[field] === uid ||
          (Array.isArray(record[field]) && record[field].includes(uid)),
      )
    )
      fail('P1401')
    if (
      table === 'privacy_jobs' &&
      record.uid === uid &&
      record.status !== 'completed'
    )
      fail('P1403')
  }
  for (const [key, value] of data) {
    const table = key.split('/')[0]
    const record = value as Record<string, unknown>
    if (
      (table === 'credentials' && key === `credentials/${uid}`) ||
      (['sessions', 'student_ids', 'privacy_jobs'].includes(table) &&
        record.uid === uid)
    )
      data.delete(key)
    if (table === 'audit_logs' && record.login) {
      const login = record.login as { memberUid?: string }
      if (
        login.memberUid === uid ||
        (record.action === 'auth.login' && record.actor === uid)
      ) {
        const next = { ...record }
        delete next.login
        data.set(key, next)
      }
    }
    if (table === 'import_jobs') {
      const job = value as ImportJob
      data.set(key, {
        ...job,
        rows: job.rows.map((row) => {
          if (
            row.uid !== uid &&
            !(
              member.studentId &&
              row.member?.studentId.toUpperCase() ===
                member.studentId.toUpperCase()
            )
          )
            return row
          const next = { ...row, error: '个人资料已随成员彻底删除' }
          delete next.member
          delete next.uid
          return next
        }),
      })
    }
  }
}
