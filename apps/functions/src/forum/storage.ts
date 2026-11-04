import { randomUUID } from 'node:crypto'
import type { Store, Transaction } from '../members/store'
import { ensure } from '../members/model'
export const IMAGE_STORAGE_KEY = 'forum:image-storage'
export async function changeImageStorage(tx: Transaction, delta: number) {
  const budget = Number(process.env.FORUM_IMAGE_BUDGET_BYTES ?? 33554432)
  ensure(
    Number.isSafeInteger(budget) && budget >= 1024 && budget <= 536870912,
    503,
    'FORUM_STORAGE_CONFIG',
    '社区图片预算配置无效',
  )
  const state = (await tx.get<{ bytes: number }>(
    'system',
    IMAGE_STORAGE_KEY,
  )) ?? { bytes: 0 }
  ensure(
    delta <= 0 || state.bytes + delta <= budget,
    409,
    'FORUM_STORAGE_BUDGET',
    '社区图片空间已达预设预算，请联系管理员整理',
  )
  await tx.set('system', IMAGE_STORAGE_KEY, {
    bytes: Math.max(0, state.bytes + delta),
  })
}
// Private maintenance only; never exposed as an HTTP initialization/cleanup API.
export async function cleanupStagedImages(
  store: Store,
  now = Date.now(),
  limit = 50,
) {
  ensure(
    Number.isInteger(limit) && limit >= 1 && limit <= 50,
    400,
    'INVALID_LIMIT',
    '每次最多处理50张图片',
  )
  let removed = 0
  const page = await store.list<{
    id: string
    status: string
    postId: string | null
    dataUrl: string
    createdAt: string
  }>(
    'forum_images',
    {
      status: 'staged',
      _createdBefore: new Date(now - 86400000).toISOString(),
    },
    { offset: 0, limit },
  )
  // Only expired candidates are queried, in bounded pages, then checked again in the transaction.
  for (const image of page.items) {
    if (removed >= limit || Date.parse(image.createdAt) > now - 86400000)
      continue
    const done = await store.run(async (tx) => {
      const current = await tx.get<typeof image>('forum_images', image.id)
      if (
        !current ||
        current.status !== 'staged' ||
        current.postId ||
        Date.parse(current.createdAt) > now - 86400000
      )
        return false
      await tx.remove('forum_images', image.id)
      await changeImageStorage(tx, -current.dataUrl.length)
      const id = randomUUID()
      await tx.set('audit_logs', id, {
        id,
        actor: 'private-forum-maintenance',
        action: 'forum.images.cleanup-staged',
        target: image.id,
        fields: [],
        createdAt: new Date(now).toISOString(),
      })
      return true
    })
    if (done) removed++
  }
  return { removed }
}
