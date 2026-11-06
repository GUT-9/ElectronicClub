import { z } from 'zod'
import { RESOURCE_TYPES } from '@electronic-club/shared'
import type { ClubResource } from '@electronic-club/shared'
import { ensure } from '../members/model'
export interface ResourceRecord extends ClubResource {
  key: string
  bucket: string
  ownerUid: string
  hash: string
  expiresAt: string
}
export const metadataInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    category: z.string().trim().min(1).max(40).default('其他'),
  })
  .strict()
export const uploadInput = metadataInput.extend({
  originalName: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine(
      (v) =>
        !/[\\/]/.test(v) &&
        Array.from(v).every(
          (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
        ),
      '文件名不能包含路径或控制字符',
    ),
  size: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024),
})
export function fileType(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  ensure(
    Object.hasOwn(RESOURCE_TYPES, ext),
    400,
    'RESOURCE_TYPE',
    '仅支持 PDF、Office、ZIP/7z、TXT/CSV 资料文件',
  )
  return { ext, mime: RESOURCE_TYPES[ext]! }
}
export function resourceView(r: ResourceRecord): ClubResource {
  const {
    id,
    title,
    description,
    category,
    originalName,
    size,
    mime,
    status,
    createdAt,
    updatedAt,
    publishedAt,
  } = r
  return {
    id,
    title,
    description,
    category,
    originalName,
    size,
    mime,
    status,
    createdAt,
    updatedAt,
    publishedAt,
  }
}
