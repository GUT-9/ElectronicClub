// Conservative client budgets, not a claim about the provider's exact limit.
// Inline images grow by ~1/3 in Base64; leave room for UTF-8 text and metadata.
export const MAX_INLINE_IMAGE_BYTES = 32 * 1024
export const MAX_CONTENT_REQUEST_BYTES = 64 * 1024

export function inlineImageBytes(value: string): number | null {
  const match =
    /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
  if (!match) return null
  const data = match[1]!
  return (
    (data.length * 3) / 4 -
    (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
  )
}

export async function fitCover(
  value: string,
  normalize = false,
): Promise<string> {
  const size = inlineImageBytes(value)
  if (size === null || (!normalize && size <= MAX_INLINE_IMAGE_BYTES))
    return value
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('图片无法解码，请重新选择图片'))
    image.src = value
  })
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > 25_000_000
  )
    throw new Error('图片尺寸过大，请选择2500万像素以内的图片')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法处理封面图片')
  let scale = Math.min(
    1,
    1600 / Math.max(image.naturalWidth, image.naturalHeight),
  )
  // JPEG stays JPEG; PNG/WebP use WebP to retain transparency. Browsers without
  // WebP canvas encoding fall back to PNG, which is still size checked below.
  const format = value.startsWith('data:image/jpeg;')
    ? 'image/jpeg'
    : 'image/webp'
  for (let attempt = 0; attempt < 10; attempt++) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.82, 0.72, 0.62]) {
      const encoded = canvas.toDataURL(format, quality)
      const bytes = inlineImageBytes(encoded)
      if (bytes !== null && bytes <= MAX_INLINE_IMAGE_BYTES) return encoded
    }
    scale *= 0.8
  }
  throw new Error('图片压缩后仍过大，请选择更小的图片')
}

export async function coverFile(
  file: File,
  normalize = false,
): Promise<string> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 1_000_000
  )
    throw new Error('请选择1MB以内的PNG/JPEG/WebP图片')
  const value = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
  return fitCover(value, normalize)
}
