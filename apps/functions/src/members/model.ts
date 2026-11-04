import {
  isValidStudentId,
  normalizeStudentId,
  STUDENT_ID_MESSAGE,
} from '@electronic-club/shared'
import { z } from 'zod'
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export function ensure(
  value: unknown,
  status: number,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new ApiError(status, code, message)
}
const text = z.string().trim().max(100)
export const studentIdSchema = z
  .string()
  .refine(isValidStudentId, STUDENT_ID_MESSAGE)
  .transform(normalizeStudentId)
export const memberSchema = z
  .object({
    studentId: studentIdSchema,
    name: z.string().trim().min(1).max(60),
    gender: z.enum(['男', '女', '其他', '未填写']).default('未填写'),
    college: text.default(''),
    major: text.default(''),
    className: text.default(''),
    grade: text.default(''),
    nickname: z.string().trim().min(1).max(60).optional(),
    phone: z
      .string()
      .regex(/^[\d+ ()-]{0,30}$/)
      .default(''),
    email: z.union([z.literal(''), z.string().email().max(200)]).default(''),
    avatar: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .max(500)
          .refine((x) => x.startsWith('https://'), '头像仅支持HTTPS地址'),
      ])
      .default(''),
    position: text.default(''),
  })
  .strict()
// Partial updates must not apply create-time defaults (notably Zod 4 defaults inside optional fields).
const patchFields = z.object({
  studentId: studentIdSchema,
  name: z.string().trim().min(1).max(60),
  nickname: z.string().trim().min(1).max(60),
  gender: z.enum(['男', '女', '其他', '未填写']),
  college: text,
  major: text,
  className: text,
  grade: text,
  phone: z.string().regex(/^[\d+ ()-]{0,30}$/),
  email: z.union([z.literal(''), z.string().email().max(200)]),
  avatar: z.union([
    z.literal(''),
    z
      .string()
      .url()
      .max(500)
      .refine((x) => x.startsWith('https://')),
  ]),
  position: text,
})
export const profileSchema = patchFields
  .pick({
    nickname: true,
    gender: true,
    phone: true,
    email: true,
    avatar: true,
  })
  .partial()
  .strict()
export const editSchema = patchFields.partial().strict()
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine(
    (x) => /[a-zA-Z]/.test(x) && /\d/.test(x),
    '密码至少8位且包含字母和数字',
  )
export const permissionDefinitions = [
  ['members.read', '成员查询', '成员'],
  ['members.create', '成员创建', '成员'],
  ['members.edit', '身份资料编辑', '成员'],
  ['members.import', 'Excel导入', '成员'],
  ['members.export', '成员导出', '成员'],
  ['members.delete', '软删除与恢复', '成员'],
  ['members.password', '密码重置', '成员'],
  ['members.status', '禁用与恢复账号', '成员'],
  ['roles.read', '角色与权限查询', '权限'],
  ['roles.assign', '分配成员角色', '权限'],
  ['roles.manage', '创建及管理角色', '权限'],
  ['audit.read', '审计日志查询', '系统'],
  ['events.create', '创建活动', '活动'],
  ['events.edit', '编辑全部活动/分配负责人', '活动'],
  ['events.delete', '删除活动', '活动'],
  ['events.registrations.read', '查询报名名单', '活动'],
  ['events.registrations.review', '审核报名', '活动'],
  ['events.registrations.export', '导出报名名单', '活动'],
  ['events.checkin.manage', '管理签到', '活动'],
  ['articles.create', '创建文章', '内容'],
  ['articles.edit', '编辑文章', '内容'],
  ['articles.publish', '发布/撤回文章', '内容'],
  ['articles.delete', '删除文章', '内容'],
  ['announcements.popup.manage', '全站弹窗管理', '内容'],
  ['forum.boards.manage', '版块管理', '电子社区'],
  ['forum.posts.review', '审核帖子', '电子社区'],
  ['forum.posts.pin', '帖子置顶', '电子社区'],
  ['forum.posts.feature', '帖子加精', '电子社区'],
  ['forum.posts.lock', '锁帖与关闭评论', '电子社区'],
  ['forum.posts.delete', '删除违规帖子', '电子社区'],
  ['forum.comments.moderate', '评论审核', '电子社区'],
  ['forum.reports.manage', '举报处理', '电子社区'],
  ['forum.users.restrict', '限制社区发言', '电子社区'],
  ['activities.create', '创建活动', '后续业务'],
  ['activities.manage', '管理活动', '后续业务'],
  ['activities.roster.read', '查看报名名单', '后续业务'],
  ['activities.roster.export', '导出报名名单', '后续业务'],
  ['articles.manage', '文章公告管理', '后续业务'],
  ['community.moderate', '帖子评论审核', '后续业务'],
  ['settings.manage', '系统设置', '后续业务'],
  ['popups.manage', '全站弹窗', '后续业务'],
].map(([id, name, group]) => ({
  id: id!,
  name: name!,
  group: group!,
  implemented: group !== '后续业务',
}))
export const roleSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300),
    permissionIds: z
      .array(z.string())
      .max(64)
      .transform((x) => [...new Set(x)]),
  })
  .strict()
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).default(''),
    college: text.default(''),
    className: text.default(''),
    roleId: z.string().max(64).default(''),
    status: z.enum(['active', 'disabled', 'deleted', 'all']).default('active'),
  })
  .strict()
