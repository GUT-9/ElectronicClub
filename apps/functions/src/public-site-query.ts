// One statement reads a consistent public export. It is callable only by the
// existing restricted backend role, never directly by browsers.
export const PUBLIC_EXPORT_SQL = `WITH
 e AS (SELECT id,data FROM electronicclub.events WHERE data->>'status'='published'),
 a AS (SELECT id,data FROM electronicclub.articles WHERE data->>'status'='published'),
 b AS (SELECT id,data FROM electronicclub.forum_boards WHERE data->>'status' IN ('active','disabled')),
 p AS (SELECT v.id,v.data FROM electronicclub.forum_posts v JOIN b ON b.id=v.data->>'boardId' WHERE v.data->>'status'='published'),
 c AS (SELECT v.id,v.data FROM electronicclub.forum_comments v JOIN p ON p.id=v.data->>'postId' WHERE v.data->>'status' IN ('published','deleted')),
 pop AS (SELECT id,data FROM electronicclub.popup_announcements WHERE data->>'enabled'='true' AND data->>'state' NOT IN ('retired','disabled') AND
   ((data->>'targetType'='event' AND data->>'targetId' IN (SELECT id FROM e)) OR (data->>'targetType'='article' AND data->>'targetId' IN (SELECT id FROM a)))),
 parents AS (SELECT 'events' kind,id FROM e UNION ALL SELECT 'articles',id FROM a UNION ALL SELECT 'forum_posts',id FROM p),
 m AS (SELECT id FROM electronicclub.media_images WHERE data->>'status'='ready' AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'bindings') v JOIN parents ON parents.kind=v->>'kind' AND parents.id=v->>'id'))
SELECT jsonb_build_object(
 'events',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM e),'[]'),
 'articles',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM a),'[]'),
 'boards',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM b),'[]'),
 'posts',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM p),'[]'),
 'comments',coalesce((SELECT jsonb_agg(c.data||jsonb_build_object('id',c.id,'parent',CASE WHEN parent.id IS NULL THEN NULL ELSE jsonb_build_object('id',parent.id,'floor',parent.data->'floor','nickname',CASE WHEN parent.data->>'status'='published' AND u.data->>'status'<>'deleted' THEN u.data->>'nickname' ELSE '已删除或隐藏' END) END)) FROM c LEFT JOIN electronicclub.forum_comments parent ON parent.id=c.data->>'parentId' LEFT JOIN electronicclub.users u ON u.id=parent.data->>'authorUid'),'[]'),
 'popups',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM pop),'[]'),
 'resources',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM electronicclub.club_resources WHERE data->>'status'='published'),'[]'),
 'authors',coalesce((SELECT jsonb_agg(jsonb_build_object('uid',id,'nickname',CASE WHEN data->>'status'='deleted' THEN '已注销成员' ELSE data->>'nickname' END,'avatar',CASE WHEN data->>'status'='active' THEN data->>'avatar' ELSE '' END)) FROM electronicclub.users WHERE id IN (SELECT data->>'authorUid' FROM p UNION SELECT data->>'authorUid' FROM c)),'[]'),
 'mediaIds',coalesce((SELECT jsonb_agg(id) FROM m),'[]'),
 'forumImageIds',coalesce((SELECT jsonb_agg(v.id) FROM electronicclub.forum_images v JOIN p ON p.id=v.data->>'postId' WHERE p.data->'imageIds' @> jsonb_build_array(v.id)),'[]'),
 'copiedAssets',coalesce((SELECT jsonb_agg(data||jsonb_build_object('id',id)) FROM electronicclub.system WHERE id LIKE 'public-site:asset:%'),'[]'),
 'timedMedia',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'popupIds',(SELECT jsonb_agg(pop.id) FROM pop WHERE m.data->'bindings' @> jsonb_build_array(jsonb_build_object('kind','popup_announcements','id',pop.id))))) FROM electronicclub.media_images m WHERE m.data->>'status'='ready' AND EXISTS(SELECT 1 FROM pop WHERE m.data->'bindings' @> jsonb_build_array(jsonb_build_object('kind','popup_announcements','id',pop.id)))),'[]')
) AS result`

export function memoryPublicExport(data: Map<string, object>) {
  const rows = (kind: string) => [...data].filter(([key]) => key.startsWith(kind + '/'))
    .map(([key, value]) => ({ ...value, id: key.slice(kind.length + 1) }) as Record<string, unknown>)
  const events = rows('events').filter((v) => v.status === 'published')
  const articles = rows('articles').filter((v) => v.status === 'published')
  const boards = rows('forum_boards').filter((v) => ['active', 'disabled'].includes(String(v.status)))
  const posts = rows('forum_posts').filter((v) => v.status === 'published' && boards.some((b) => b.id === v.boardId))
  const comments = rows('forum_comments').filter((v) => ['published', 'deleted'].includes(String(v.status)) && posts.some((p) => p.id === v.postId))
  const authors = rows('users').map((v) => ({ uid: v.id, nickname: v.status === 'deleted' ? '已注销成员' : v.nickname, avatar: v.status === 'active' ? v.avatar : '' }))
  for (const comment of comments) {
    const parent = data.get('forum_comments/' + comment.parentId) as Record<string, unknown> | undefined
    comment.parent = parent ? { id: comment.parentId, floor: parent.floor,
      nickname: parent.status === 'published' ? authors.find((v) => v.uid === parent.authorUid)?.nickname ?? '已注销成员' : '已删除或隐藏' } : null
  }
  const popups = rows('popup_announcements').filter((v) => v.enabled && !['retired', 'disabled'].includes(String(v.state)) &&
    (v.targetType === 'event' ? events : articles).some((p) => p.id === v.targetId))
  const parents = { events, articles, forum_posts: posts }
  const mediaIds = rows('media_images').filter((v) => v.status === 'ready' &&
    (v.bindings as { kind: keyof typeof parents; id: string }[]).some((binding) => parents[binding.kind]?.some((p) => p.id === binding.id))).map((v) => v.id)
  const forumImageIds = rows('forum_images').filter((v) => posts.some((p) => p.id === v.postId && (p.imageIds as string[]).includes(String(v.id)))).map((v) => v.id)
  return { events, articles, boards, posts, comments, popups, authors, mediaIds, forumImageIds,
    copiedAssets: rows('system').filter((v) => String(v.id).startsWith('public-site:asset:')),
    timedMedia: rows('media_images').filter((v) => v.status === 'ready').map((v) => ({ id: v.id, popupIds: popups.filter((p) =>
      (v.bindings as { kind: string; id: string }[]).some((binding) => binding.kind === 'popup_announcements' && binding.id === p.id)).map((p) => p.id) })).filter((v) => v.popupIds.length),
    resources: rows('club_resources').filter((v) => v.status === 'published') }
}
