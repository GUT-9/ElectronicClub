import type { AuditLog } from './members'
export const FORUM_PERMISSIONS = [
  'forum.boards.manage',
  'forum.posts.review',
  'forum.posts.pin',
  'forum.posts.feature',
  'forum.posts.lock',
  'forum.posts.delete',
  'forum.comments.moderate',
  'forum.reports.manage',
  'forum.users.restrict',
] as const
export interface ForumBoard {
  id: string
  name: string
  description: string
  position: number
  status: 'active' | 'hidden' | 'disabled'
  requireReview: boolean
  createdAt: string
  updatedAt: string
}
export interface ForumPost {
  id: string
  boardId: string
  authorUid: string
  title: string
  body: string
  imageIds: string[]
  status: 'pending' | 'published' | 'hidden' | 'deleted'
  pinned: boolean
  featured: boolean
  locked: boolean
  commentsClosed: boolean
  viewCount: number
  likeCount: number
  commentCount: number
  commentSequence: number
  lastReplyAt: string
  createdAt: string
  updatedAt: string
  moderationReason?: string
}
export interface ForumComment {
  id: string
  postId: string
  authorUid: string
  parentId: string | null
  body: string
  status: 'published' | 'hidden' | 'deleted'
  floor: number
  createdAt: string
  updatedAt: string
}
export interface ForumAuthor {
  uid: string
  nickname: string
  avatar: string
}
export type ForumPostView = ForumPost & {
  author: ForumAuthor
  board: ForumBoard
}
export type ForumCommentView = ForumComment & {
  author: ForumAuthor
  parent?: { id: string; floor: number; nickname: string } | null
}
export interface ForumReport {
  id: string
  reporterUid: string
  targetType: 'post' | 'comment'
  targetId: string
  postId: string
  reason: string
  status: 'open' | 'resolved' | 'dismissed'
  resolution: string
  createdAt: string
  updatedAt: string
}
export interface ForumRestriction {
  id: string
  uid: string
  postsUntil: string | null
  commentsUntil: string | null
  posts: boolean
  comments: boolean
  reason: string
  createdAt: string
  updatedAt: string
}
export interface ForumNotification {
  id: string
  recipientUid: string
  postId: string
  commentId: string | null
  message: string
  read: boolean
  createdAt: string
}
export const FORUM_PERMISSION_LABELS: Record<string, string> = {
  'forum.boards.manage': '版块管理',
  'forum.posts.review': '审核帖子',
  'forum.posts.pin': '帖子置顶',
  'forum.posts.feature': '帖子加精',
  'forum.posts.lock': '锁帖与关闭评论',
  'forum.posts.delete': '删除违规帖子',
  'forum.comments.moderate': '评论审核',
  'forum.reports.manage': '举报处理',
  'forum.users.restrict': '限制社区发言',
}
export const DEFAULT_FORUM_BOARDS = [
  '综合交流',
  '单片机与嵌入式',
  '电路设计与 PCB',
  '焊接与电子制作',
  '电赛交流',
  '项目分享',
  '编程与软件开发',
].map((name, index) => ({
  id: `board-${index + 1}`,
  name,
  description:
    name === '电赛交流'
      ? '全国大学生电子设计竞赛学习与交流'
      : '分享实践经验，一起解决问题',
  position: index + 1,
  status: 'active' as const,
  requireReview: false,
}))

export type ForumAuditLog = AuditLog & {
  details?: Record<string, string | boolean>
}
