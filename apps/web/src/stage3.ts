export const beijing = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '未发布'
export const localTime = (value: string) =>
  value
    ? new Date(new Date(value).getTime() + 8 * 3600000)
        .toISOString()
        .slice(0, 16)
    : ''
export const utcTime = (value: string) =>
  value ? new Date(value + ':00+08:00').toISOString() : ''
export async function coverFile(file: File): Promise<string> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 1000000
  )
    throw new Error('请选择1MB以内的PNG/JPEG/WebP图片')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}
export const dismissedPopup = (version: string) => {
  try {
    return sessionStorage.getItem('ec-popup:' + version) === 'closed'
  } catch {
    return true
  }
}
export const dismissPopup = (version: string) => {
  try {
    sessionStorage.setItem('ec-popup:' + version, 'closed')
  } catch {
    /* No persistent storage: skip popup to avoid repetition. */
  }
}
