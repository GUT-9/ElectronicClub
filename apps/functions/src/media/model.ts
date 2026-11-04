import type { Identity } from '@electronic-club/shared'
import {
  bodyMedia,
  mediaReference,
  MAX_BODY_IMAGES,
} from '@electronic-club/shared'
import type { Transaction } from '../members/store'
import { ensure } from '../members/model'
export type MediaKind =
  'events' | 'articles' | 'forum_posts' | 'popup_announcements'
export interface MediaImage {
  id: string
  ownerUid: string
  mime: string
  bytes: number
  chunkCount: number
  status: 'uploading' | 'ready'
  bindings: { kind: MediaKind; id: string }[]
  createdAt: string
  width?: number
  height?: number
}
export function references(body = '', cover = '') {
  ensure(
    bodyMedia(body).length <= MAX_BODY_IMAGES,
    400,
    'IMAGE_LIMIT',
    '每篇正文最多12张图片',
  )
  return [
    ...new Set([
      ...bodyMedia(body),
      ...(mediaReference(cover) ? [mediaReference(cover)!] : []),
    ]),
  ]
}
export async function syncMedia(
  tx: Transaction,
  ctx: Identity,
  kind: MediaKind,
  id: string,
  next: string[],
  previous: string[] = [],
  trustedImages: string[] = [],
) {
  ensure(
    next.length <= MAX_BODY_IMAGES + 1,
    400,
    'IMAGE_LIMIT',
    '每篇正文最多12张图片，另可设置1张封面',
  )
  for (const imageId of new Set([...next, ...previous])) {
    const image = await tx.get<MediaImage>('media_images', imageId)
    if (!next.includes(imageId)) {
      if (image) {
        image.bindings = image.bindings.filter(
          (b) => b.kind !== kind || b.id !== id,
        )
        await tx.set('media_images', imageId, image)
      }
      continue
    }
    ensure(
      image?.status === 'ready',
      400,
      'INVALID_MEDIA',
      '图片未上传完成或不存在，请重新插入图片',
    )
    const existing = image.bindings.some((b) => b.kind === kind && b.id === id)
    ensure(
      existing ||
        image.ownerUid === ctx.member.uid ||
        trustedImages.includes(imageId),
      403,
      'MEDIA_OWNER',
      '不能使用其他成员尚未授权的图片',
    )
    if (!existing) {
      ensure(
        image.bindings.length < 20,
        409,
        'MEDIA_LINK_LIMIT',
        '图片已被过多内容引用，请重新上传',
      )
      image.bindings.push({ kind, id })
      await tx.set('media_images', imageId, image)
    }
  }
}
