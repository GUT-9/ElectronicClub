import { request } from './member-api'

type SavedPublication = { id: string; cover?: string; managerIds?: string[] }

// Do not treat the local FileReader preview or a successful write response as
// evidence that the deployed backend persisted the image.
export async function savePublication(
  kind: 'events' | 'articles',
  id: string,
  data: Record<string, unknown> & { cover: string },
  send: typeof request = request,
  onSubmitted?: (saved: SavedPublication) => void,
): Promise<SavedPublication> {
  const saved = await send<SavedPublication>(
    `/${kind}${id ? '/' + id + '/update' : ''}`,
    'POST',
    data,
  )
  onSubmitted?.(saved)
  try {
    const persisted = await send<SavedPublication>(`/${kind}/${saved.id}`)
    if (persisted.cover !== data.cover)
      throw new Error('服务器重新读取的封面与所选图片不一致')
  } catch (error) {
    throw new Error(
      `内容已提交，但封面保存未确认：${(error as Error).message}。请刷新后台核对，勿重复新建；若封面仍为空，请检查云函数版本及保存请求日志。`,
    )
  }
  return saved
}
