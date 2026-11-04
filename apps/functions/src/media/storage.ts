import { randomUUID } from 'node:crypto'
import type { Store } from '../members/store'
import type { MediaImage } from './model'
import { removeMedia } from './service'
export async function cleanupMedia(store: Store, now = Date.now()) {
  const before = new Date(now - 86400000).toISOString()
  const images = await store.list<MediaImage>(
    'media_expired',
    { before },
    { offset: 0, limit: 50 },
  )
  let removed = 0
  for (const image of images.items) {
    const done = await store.run(async (tx) => {
      const current = await tx.get<MediaImage>('media_images', image.id)
      if (!current || current.bindings.length || current.createdAt >= before)
        return false
      await removeMedia(tx, current)
      const id = randomUUID()
      await tx.set('audit_logs', id, {
        id,
        actor: 'private-forum-maintenance',
        action: 'media.cleanup-staged',
        target: current.id,
        fields: [],
        createdAt: new Date(now).toISOString(),
      })
      return true
    })
    if (done) removed++
  }
  return { removed }
}
