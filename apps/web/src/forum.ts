import { FORUM_PERMISSIONS } from '@electronic-club/shared'
export { FORUM_PERMISSIONS }
export const forumImageUrl = (id: string, live = false) =>
  `/api/forum/images/${encodeURIComponent(id)}${live ? '?live=true' : ''}`
export const forumStatus: Record<string, string> = {
  pending: '待审核',
  published: '已发布',
  hidden: '已隐藏',
  deleted: '已删除',
  open: '待处理',
  resolved: '已处理',
  dismissed: '不予受理',
  active: '正常',
  disabled: '停用',
}
