export const MAX_SOURCE_IMAGE_BYTES = 3 * 1024 * 1024
export const MAX_MEDIA_IMAGE_BYTES = 50 * 1024
export const MEDIA_CHUNK_BYTES = 24 * 1024
export const MAX_BODY_IMAGES = 12
export const mediaIdPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export function mediaReference(value: string): string | null {
  return new RegExp(`^media:(${mediaIdPattern})$`).exec(value)?.[1] ?? null
}
export function bodyMedia(content: string): string[] {
  return [
    ...new Set(
      Array.from(
        content.matchAll(
          new RegExp(
            `^!\\[[^\\]\\n]{0,160}\\]\\(media:(${mediaIdPattern})\\)\\s*$`,
            'gm',
          ),
        ),
        (m) => m[1]!,
      ),
    ),
  ]
}
export function imageLine(line: string): { id: string; alt: string } | null {
  const m = new RegExp(
    `^!\\[([^\\]\\n]{0,160})\\]\\(media:(${mediaIdPattern})\\)\\s*$`,
  ).exec(line)
  return m ? { id: m[2]!, alt: m[1] || '正文图片' } : null
}
export function permissionGroup(id: string): string {
  if (id.startsWith('members.'))
    return ['members.password', 'members.status', 'members.delete'].includes(id)
      ? '账号与安全'
      : '成员资料'
  if (id.startsWith('roles.')) return '角色与授权'
  if (id.startsWith('events.registrations.')) return '报名管理'
  if (id.startsWith('events.checkin.')) return '活动签到'
  if (id.startsWith('events.')) return '活动发布'
  if (id.startsWith('articles.'))
    return id === 'articles.manage' ? '预留功能' : '新闻与公告'
  if (id === 'announcements.popup.manage') return '全站弹窗'
  if (id === 'forum.boards.manage') return '社区版块'
  if (id.startsWith('forum.posts.')) return '社区帖子'
  if (id === 'forum.comments.moderate') return '社区评论'
  if (id.startsWith('forum.')) return '社区举报与秩序'
  if (id === 'audit.read') return '操作审计'
  return '预留功能'
}
export const PERMISSION_GROUP_ORDER = [
  '成员资料',
  '账号与安全',
  '角色与授权',
  '活动发布',
  '报名管理',
  '活动签到',
  '新闻与公告',
  '全站弹窗',
  '社区版块',
  '社区帖子',
  '社区评论',
  '社区举报与秩序',
  '操作审计',
  '预留功能',
]
