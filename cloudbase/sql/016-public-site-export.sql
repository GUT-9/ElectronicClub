-- Public object-storage export. Additive, idempotent, no account/data resets.
BEGIN;
SELECT pg_advisory_xact_lock(1991,1);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM electronicclub.schema_migrations WHERE version='015-event-operations') THEN RAISE EXCEPTION 'APPLY_015_FIRST'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.ec_public_site_export() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
 PERFORM electronicclub.ec_assert_backend_role();
 WITH
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
) AS result INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'PUBLIC_EXPORT_TOO_LARGE'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ec_public_site_export() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ec_public_site_export() TO service_role;
INSERT INTO electronicclub.schema_migrations(version) VALUES('016-public-site-export') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
