import type { ListOptions } from '../members/store'
import { validateForumQuery } from './query'
export function memoryForumList<T>(
  collection: string,
  filter: Record<string, unknown>,
  options: ListOptions,
  data: Map<string, object>,
) {
  validateForumQuery(collection, filter, options)
  const visible = (p: Record<string, unknown>) =>
    p.status === 'published' &&
    ['active', 'disabled'].includes(
      String(
        (
          data.get('forum_boards/' + p.boardId) as
            Record<string, unknown> | undefined
        )?.status,
      ),
    )
  const rows = [...data]
    .filter(([k]) => k.startsWith(collection + '/'))
    .map(
      ([k, v]) =>
        ({ ...v, id: k.slice(collection.length + 1) }) as Record<
          string,
          unknown
        >,
    )
    .filter((r) =>
      Object.entries(filter).every(([k, v]) => {
        if (k === '_public')
          return collection === 'forum_boards'
            ? ['active', 'disabled'].includes(String(r.status))
            : collection === 'forum_posts'
              ? visible(r)
              : collection === 'forum_comments'
                ? ['published', 'deleted'].includes(String(r.status)) &&
                  visible(
                    (data.get('forum_posts/' + r.postId) ?? {}) as Record<
                      string,
                      unknown
                    >,
                  )
                : false
        if (k === '_forumAudit') return String(r.action).startsWith('forum.')
        if (k === '_notDeleted') return r.status !== 'deleted'
        if (k === '_createdBefore')
          return Date.parse(String(r.createdAt)) < Date.parse(String(v))
        if (k === '_beforeFloor') return Number(r.floor) < Number(v)
        if (k === '_search')
          return [r.title, r.body, r.name]
            .join(' ')
            .toLowerCase()
            .includes(String(v).toLowerCase())
        if (k === '_favoriteUid')
          return data.has(`forum_favorites/${r.id}:${v}`)
        if (k === '_featured') return r.featured === true
        if (k === '_sort') return true
        return r[k] === v
      }),
    )
    .sort((a, b) => {
      if (collection === 'forum_boards')
        return (
          Number(a.position) - Number(b.position) ||
          String(a.id).localeCompare(String(b.id))
        )
      if (collection === 'forum_comments')
        return Number(a.floor) - Number(b.floor)
      if (collection === 'forum_posts') {
        const pinned = Number(b.pinned) - Number(a.pinned)
        if (pinned) return pinned
        if (filter._sort === 'hot') {
          const score = (p: Record<string, unknown>) =>
            Number(p.likeCount) * 3 + Number(p.commentCount) * 2
          const d = score(b) - score(a)
          if (d) return d
        }
        if (filter._sort === 'reply')
          return (
            String(b.lastReplyAt).localeCompare(String(a.lastReplyAt)) ||
            String(a.id).localeCompare(String(b.id))
          )
      }
      return (
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        String(a.id).localeCompare(String(b.id))
      )
    })
  if (collection === 'forum_images') for (const row of rows) delete row.dataUrl
  return {
    items: structuredClone(
      rows.slice(options.offset, options.offset + options.limit),
    ) as T[],
    total: rows.length,
  }
}
