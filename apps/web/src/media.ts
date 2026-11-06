import {
  MAX_MEDIA_IMAGE_BYTES,
  MEDIA_CHUNK_BYTES,
  mediaReference,
} from '@electronic-club/shared'
import { coverFile, inlineImageBytes } from './cover'
import { request } from './member-api'
export const mediaUrl = (id: string) =>
  `/api/media/${encodeURIComponent(id)}`
export function imageSource(value: string) {
  const id = mediaReference(value)
  return id
    ? mediaUrl(id)
    : /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(value)
      ? value
      : ''
}
export async function uploadImage(
  file: File,
): Promise<{ id: string; reference: string; preview: string; bytes: number }> {
  const preview = await coverFile(file, true, MAX_MEDIA_IMAGE_BYTES),
    bytes = inlineImageBytes(preview)!
  const mime = /^data:([^;]+);/.exec(preview)![1],
    encoded = preview.split(',')[1]!
  const image = await request<{ id: string; chunkCount: number }>(
    '/media',
    'POST',
    { mime, bytes },
  )
  try {
    // 24KiB raw -> 32KiB Base64. Both browser requests and SQL RPC commits
    // stay below the conservative 64KiB gateway budget, even for a 50KiB image.
    for (let n = 0; n < image.chunkCount; n++)
      await request(`/media/${image.id}/chunks/${n}`, 'POST', {
        data: encoded.slice(
          n * ((MEDIA_CHUNK_BYTES / 3) * 4),
          (n + 1) * ((MEDIA_CHUNK_BYTES / 3) * 4),
        ),
      })
    await request(`/media/${image.id}/complete`, 'POST', {})
    return { id: image.id, reference: 'media:' + image.id, preview, bytes }
  } catch (e) {
    void request(`/media/${image.id}/delete`, 'POST', {}).catch(() => {})
    throw e
  }
}
