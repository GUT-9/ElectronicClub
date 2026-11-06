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
  if (id && saved.id !== id)
    throw new Error(
      '编辑接口返回了不同的记录ID，尚未确认原记录已更新。请勿重复新建；请更新云函数并检查记录主键与内容ID是否一致。',
    )
  onSubmitted?.(saved)
  try {
    const persisted = await send<SavedPublication>(`/${kind}/${saved.id}`)
    if (persisted.id !== saved.id || persisted.cover !== data.cover)
      throw new Error('服务器重新读取的封面与所选图片不一致')
    if (kind === 'events' && Array.isArray(data.managerIds)) {
      const expected = [...new Set(data.managerIds as string[])]
      if (
        !persisted.managerIds ||
        expected.some((uid) => !persisted.managerIds!.includes(uid)) ||
        (id && expected.length !== persisted.managerIds.length)
      )
        throw new Error(
          '服务器重新读取的负责人与所选名单不一致，请刷新核对负责人是否保存',
        )
    }
    return persisted
  } catch (error) {
    throw new Error(
      `内容已提交，但${Array.isArray(data.managerIds) ? '保存结果' : '封面保存'}未确认：${(error as Error).message}。请刷新后台核对，确认前请勿重复新建。`,
    )
  }
}
