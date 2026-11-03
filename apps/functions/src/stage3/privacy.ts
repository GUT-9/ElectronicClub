import { randomUUID } from 'node:crypto'
import type {
  Registration,
  ClubArticle,
  ClubEvent,
} from '@electronic-club/shared'
import type { Store } from '../members/store'
// Private maintenance only. The caller checks the existing pending privacy job first.
export async function cleanStage3Privacy(store: Store, uid: string) {
  if (!(await store.read('system', 'stage3_catalog'))) return
  for (const collection of [
    'registrations',
    'articles',
    'events',
    'checkins',
  ]) {
    let offset = 0
    for (;;) {
      const result = await store.list<Registration | ClubArticle | ClubEvent>(
        collection,
        collection === 'registrations' || collection === 'checkins'
          ? { uid }
          : {},
        { offset, limit: 100 },
      )
      for (const record of result.items) {
        if ('publisherUid' in record && record.publisherUid !== uid) continue
        await store.run(async (tx) => {
          const control = await tx.get<{ revision: number }>(
            'system',
            'control',
          )
          if (!control) throw new Error('NOT_INITIALIZED')
          await tx.set('system', 'control', {
            ...control,
            revision: control.revision + 1,
          })
          const current = await tx.get<Registration | ClubArticle | ClubEvent>(
            collection,
            record.id,
          )
          if (!current) return
          if (collection === 'checkins')
            await tx.set(collection, record.id, {
              ...current,
              reason: '',
              updatedAt: new Date().toISOString(),
            })
          else if ('snapshot' in current)
            await tx.set(collection, record.id, {
              ...current,
              snapshot: {
                studentId: '',
                name: '已匿名化',
                gender: '未填写',
                college: '',
                major: '',
                className: '',
                grade: '',
              },
              note: '',
              updatedAt: new Date().toISOString(),
            })
          else
            await tx.set(collection, record.id, {
              ...current,
              publisherName: '已匿名化',
              updatedAt: new Date().toISOString(),
            })
        })
      }
      offset += 100
      if (offset >= result.total) break
    }
  }
  const id = randomUUID()
  await store.run((tx) =>
    tx.set('audit_logs', id, {
      id,
      actor: 'private-maintenance',
      action: 'privacy.stage3_cleanup',
      target: uid,
      fields: ['registration.snapshot', 'registration.note', 'publisherName'],
      createdAt: new Date().toISOString(),
    }),
  )
}
