import {
  mediaReference,
  MAX_EVENT_MANAGERS,
  DEFAULT_CHECKIN_TTL_SECONDS,
  MAX_CHECKIN_TTL_SECONDS,
} from '@electronic-club/shared'
import { z } from 'zod'
const text = z.string().trim()
export const image = z
  .string()
  .max(1_500_000)
  .refine(
    (v) =>
      !v ||
      !!mediaReference(v) ||
      /^https:\/\/[^\s]+$/i.test(v) ||
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
    '图片须为HTTPS地址或PNG/JPEG/WebP图片',
  )
const date = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString())
const optionalDate = z.union([date, z.literal('')]).default('')
export const eventSchema = z
  .object({
    title: text.min(1).max(120),
    summary: text.max(500).default(''),
    content: z.string().max(100000).default(''),
    cover: image.default(''),
    location: text.max(200).default(''),
    startsAt: date,
    endsAt: date,
    status: z.enum(['draft', 'published', 'disabled']).default('draft'),
    registrationEnabled: z.boolean().default(false),
    registrationStartsAt: optionalDate,
    registrationDeadline: optionalDate,
    capacity: z.number().int().min(1).max(100000).nullable().default(null),
    allowCancellation: z.boolean().default(true),
    approvalRequired: z.boolean().default(false),
    notesEnabled: z.boolean().default(false),
    notesRequired: z.boolean().default(false),
    checkinEnabled: z.boolean().default(false),
    checkinTtlSeconds: z
      .number()
      .int()
      .min(30)
      .max(MAX_CHECKIN_TTL_SECONDS)
      .default(DEFAULT_CHECKIN_TTL_SECONDS),
    managerIds: z
      .array(z.string().uuid())
      .max(MAX_EVENT_MANAGERS)
      .transform((ids) => [...new Set(ids)])
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endsAt <= v.startsAt)
      ctx.addIssue({ code: 'custom', message: '结束时间须晚于开始时间' })
    if (
      v.registrationEnabled &&
      (!v.registrationDeadline || v.registrationDeadline > v.endsAt)
    )
      ctx.addIssue({
        code: 'custom',
        message: '开启报名必须设置不晚于活动结束的截止时间',
      })
    if (
      v.registrationStartsAt &&
      v.registrationDeadline &&
      v.registrationStartsAt >= v.registrationDeadline
    )
      ctx.addIssue({ code: 'custom', message: '报名开始须早于截止' })
    if (v.notesRequired && !v.notesEnabled)
      ctx.addIssue({ code: 'custom', message: '必填备注须先启用备注' })
  })
export const articleSchema = z
  .object({
    title: text.min(1).max(120),
    summary: text.max(500).default(''),
    content: z.string().max(100000),
    cover: image.default(''),
    category: text.min(1).max(40).default('公告'),
    pinned: z.boolean().default(false),
    status: z.enum(['draft', 'published', 'withdrawn']).default('draft'),
  })
  .strict()
export const popupSchema = z
  .object({
    title: text.min(1).max(120),
    summary: text.max(500).default(''),
    image: image.default(''),
    buttonText: text.min(1).max(30).default('查看详情'),
    targetType: z.enum(['event', 'article']),
    targetId: z.string().uuid(),
    startsAt: date,
    expiresAt: date,
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
  .refine((v) => v.expiresAt > v.startsAt, '失效时间须晚于生效时间')
