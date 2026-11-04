import { z } from 'zod'
export const boardInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(300).default(''),
    position: z.number().int().min(0).max(1000).default(0),
    status: z.enum(['active', 'hidden', 'disabled']).default('active'),
    requireReview: z.boolean().default(false),
  })
  .strict()
export const postInput = z
  .object({
    title: z.string().trim().min(2).max(120),
    body: z.string().trim().min(2).max(6000),
    boardId: z.string().min(1).max(60),
    imageIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .strict()
export const commentInput = z
  .object({
    body: z.string().trim().min(1).max(1500),
    parentId: z.string().uuid().nullable().default(null),
  })
  .strict()
export const moderationInput = z
  .object({
    action: z.enum([
      'approve',
      'hide',
      'delete',
      'pin',
      'feature',
      'lock',
      'close-comments',
    ]),
    value: z.boolean().default(true),
    reason: z.string().trim().min(1).max(300),
  })
  .strict()
export const reasonInput = z
  .object({ reason: z.string().trim().min(2).max(500) })
  .strict()
export const restrictionInput = z
  .object({
    studentId: z.string().min(4).max(24),
    posts: z.boolean(),
    comments: z.boolean(),
    postsUntil: z.string().datetime({ offset: true }).nullable(),
    commentsUntil: z.string().datetime({ offset: true }).nullable(),
    reason: z.string().trim().min(2).max(300),
  })
  .strict()
export const imageInput = z.object({ dataUrl: z.string().max(45000) }).strict()
