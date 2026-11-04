-- Additive media storage and permission labels. No user/password/role-assignment changes.
BEGIN;
SELECT pg_advisory_xact_lock(1991,1);
CREATE TABLE IF NOT EXISTS electronicclub.media_images(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 CONSTRAINT media_image_identity CHECK((data->>'id'=id) IS TRUE),
 CONSTRAINT media_image_size CHECK(((data->>'bytes')::int BETWEEN 20 AND 51200) IS TRUE),
 CONSTRAINT media_image_chunks CHECK(((data->>'chunkCount')::int BETWEEN 1 AND 3 AND (data->>'chunkCount')::int=((data->>'bytes')::int+24575)/24576) IS TRUE),
 CONSTRAINT media_image_status CHECK((data->>'status' IN ('uploading','ready')) IS TRUE),
 CONSTRAINT media_image_mime CHECK((data->>'mime' IN ('image/jpeg','image/png','image/webp')) IS TRUE),
 CONSTRAINT media_image_bindings CHECK((jsonb_typeof(data->'bindings')='array' AND jsonb_array_length(data->'bindings')<=20) IS TRUE),
 owner_uid text GENERATED ALWAYS AS (data->>'ownerUid') STORED NOT NULL REFERENCES electronicclub.users(id));
CREATE TABLE IF NOT EXISTS electronicclub.media_chunks(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 image_id text GENERATED ALWAYS AS (data->>'imageId') STORED REFERENCES electronicclub.media_images(id) ON DELETE CASCADE,
 CONSTRAINT media_chunk_identity CHECK((data->>'id'=id AND id=(data->>'imageId')||':'||(data->>'index')) IS TRUE),
 CONSTRAINT media_chunk_index CHECK(((data->>'index')::int BETWEEN 0 AND 2) IS TRUE),
 CONSTRAINT media_chunk_size CHECK((length(data->>'data') BETWEEN 1 AND 32768) IS TRUE));
CREATE INDEX IF NOT EXISTS media_chunks_image ON electronicclub.media_chunks(image_id);
CREATE INDEX IF NOT EXISTS media_images_owner ON electronicclub.media_images(owner_uid,(data->>'createdAt'));
CREATE INDEX IF NOT EXISTS media_images_unbound ON electronicclub.media_images((data->>'createdAt')) WHERE data->'bindings'='[]'::jsonb;
CREATE OR REPLACE FUNCTION electronicclub.ec_table(p_collection text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p_collection NOT IN ('media_images','media_chunks','forum_boards','forum_posts','forum_comments','forum_likes','forum_favorites','forum_reports','forum_user_restrictions','forum_notifications','forum_images','events','event_managers','registrations','checkins','articles','popup_announcements','popup_state','users','roles','permissions','credentials','sessions','student_ids','audit_logs','import_jobs','login_limits','system','privacy_jobs') THEN RAISE EXCEPTION 'INVALID_COLLECTION'; END IF;
 RETURN format('electronicclub.%I',p_collection);
END $$;
REVOKE ALL ON electronicclub.media_images FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON electronicclub.media_images FROM %I',browser_role); END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.media_images TO service_role;
REVOKE ALL ON electronicclub.media_chunks FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON electronicclub.media_chunks FROM %I',browser_role); END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.media_chunks TO service_role;
CREATE OR REPLACE FUNCTION public.ec_media_expired(p_before text,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
PERFORM electronicclub.ec_assert_backend_role();
IF p_before IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'INVALID_MEDIA_QUERY'; END IF;
PERFORM p_before::timestamptz;
EXECUTE 'WITH selected AS (SELECT id,data FROM electronicclub.media_images WHERE data->''bindings''=''[]''::jsonb AND data->>''createdAt''<$1 ORDER BY data->>''createdAt'',id LIMIT $2) SELECT jsonb_build_object(''total'',(SELECT count(*) FROM selected),''items'',coalesce((SELECT jsonb_agg(data ORDER BY data->>''createdAt'',id) FROM selected),''[]''::jsonb)) AS result' INTO result USING p_before,p_limit;
RETURN result;END $$;
REVOKE ALL ON FUNCTION public.ec_media_expired(text,integer) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.ec_media_expired(text,integer) FROM %I',browser_role); END LOOP; END $$;
GRANT EXECUTE ON FUNCTION public.ec_media_expired(text,integer) TO service_role;
UPDATE electronicclub.permissions SET data=data||'{"id":"members.read","name":"成员查询","group":"成员资料","implemented":true}'::jsonb WHERE id='members.read';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.create","name":"成员创建","group":"成员资料","implemented":true}'::jsonb WHERE id='members.create';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.edit","name":"身份资料编辑","group":"成员资料","implemented":true}'::jsonb WHERE id='members.edit';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.import","name":"Excel导入","group":"成员资料","implemented":true}'::jsonb WHERE id='members.import';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.export","name":"成员导出","group":"成员资料","implemented":true}'::jsonb WHERE id='members.export';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.delete","name":"软删除与恢复","group":"账号与安全","implemented":true}'::jsonb WHERE id='members.delete';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.password","name":"密码重置","group":"账号与安全","implemented":true}'::jsonb WHERE id='members.password';
UPDATE electronicclub.permissions SET data=data||'{"id":"members.status","name":"禁用与恢复账号","group":"账号与安全","implemented":true}'::jsonb WHERE id='members.status';
UPDATE electronicclub.permissions SET data=data||'{"id":"roles.read","name":"角色与权限查询","group":"角色与授权","implemented":true}'::jsonb WHERE id='roles.read';
UPDATE electronicclub.permissions SET data=data||'{"id":"roles.assign","name":"分配成员角色","group":"角色与授权","implemented":true}'::jsonb WHERE id='roles.assign';
UPDATE electronicclub.permissions SET data=data||'{"id":"roles.manage","name":"创建及管理角色","group":"角色与授权","implemented":true}'::jsonb WHERE id='roles.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"audit.read","name":"审计日志查询","group":"操作审计","implemented":true}'::jsonb WHERE id='audit.read';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.create","name":"创建活动","group":"活动发布","implemented":true}'::jsonb WHERE id='events.create';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.edit","name":"编辑全部活动/分配负责人","group":"活动发布","implemented":true}'::jsonb WHERE id='events.edit';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.delete","name":"删除活动","group":"活动发布","implemented":true}'::jsonb WHERE id='events.delete';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.registrations.read","name":"查询报名名单","group":"报名管理","implemented":true}'::jsonb WHERE id='events.registrations.read';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.registrations.review","name":"审核报名","group":"报名管理","implemented":true}'::jsonb WHERE id='events.registrations.review';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.registrations.export","name":"导出报名名单","group":"报名管理","implemented":true}'::jsonb WHERE id='events.registrations.export';
UPDATE electronicclub.permissions SET data=data||'{"id":"events.checkin.manage","name":"管理签到","group":"活动签到","implemented":true}'::jsonb WHERE id='events.checkin.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"articles.create","name":"创建文章","group":"新闻与公告","implemented":true}'::jsonb WHERE id='articles.create';
UPDATE electronicclub.permissions SET data=data||'{"id":"articles.edit","name":"编辑文章","group":"新闻与公告","implemented":true}'::jsonb WHERE id='articles.edit';
UPDATE electronicclub.permissions SET data=data||'{"id":"articles.publish","name":"发布/撤回文章","group":"新闻与公告","implemented":true}'::jsonb WHERE id='articles.publish';
UPDATE electronicclub.permissions SET data=data||'{"id":"articles.delete","name":"删除文章","group":"新闻与公告","implemented":true}'::jsonb WHERE id='articles.delete';
UPDATE electronicclub.permissions SET data=data||'{"id":"announcements.popup.manage","name":"全站弹窗管理","group":"全站弹窗","implemented":true}'::jsonb WHERE id='announcements.popup.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.boards.manage","name":"版块管理","group":"社区版块","implemented":true}'::jsonb WHERE id='forum.boards.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.posts.review","name":"审核帖子","group":"社区帖子","implemented":true}'::jsonb WHERE id='forum.posts.review';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.posts.pin","name":"帖子置顶","group":"社区帖子","implemented":true}'::jsonb WHERE id='forum.posts.pin';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.posts.feature","name":"帖子加精","group":"社区帖子","implemented":true}'::jsonb WHERE id='forum.posts.feature';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.posts.lock","name":"锁帖与关闭评论","group":"社区帖子","implemented":true}'::jsonb WHERE id='forum.posts.lock';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.posts.delete","name":"删除违规帖子","group":"社区帖子","implemented":true}'::jsonb WHERE id='forum.posts.delete';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.comments.moderate","name":"评论审核","group":"社区评论","implemented":true}'::jsonb WHERE id='forum.comments.moderate';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.reports.manage","name":"举报处理","group":"社区举报与秩序","implemented":true}'::jsonb WHERE id='forum.reports.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"forum.users.restrict","name":"限制社区发言","group":"社区举报与秩序","implemented":true}'::jsonb WHERE id='forum.users.restrict';
UPDATE electronicclub.permissions SET data=data||'{"id":"activities.create","name":"创建活动","group":"预留功能","implemented":false}'::jsonb WHERE id='activities.create';
UPDATE electronicclub.permissions SET data=data||'{"id":"activities.manage","name":"管理活动","group":"预留功能","implemented":false}'::jsonb WHERE id='activities.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"activities.roster.read","name":"查看报名名单","group":"预留功能","implemented":false}'::jsonb WHERE id='activities.roster.read';
UPDATE electronicclub.permissions SET data=data||'{"id":"activities.roster.export","name":"导出报名名单","group":"预留功能","implemented":false}'::jsonb WHERE id='activities.roster.export';
UPDATE electronicclub.permissions SET data=data||'{"id":"articles.manage","name":"文章公告管理","group":"预留功能","implemented":false}'::jsonb WHERE id='articles.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"community.moderate","name":"帖子评论审核","group":"预留功能","implemented":false}'::jsonb WHERE id='community.moderate';
UPDATE electronicclub.permissions SET data=data||'{"id":"settings.manage","name":"系统设置","group":"预留功能","implemented":false}'::jsonb WHERE id='settings.manage';
UPDATE electronicclub.permissions SET data=data||'{"id":"popups.manage","name":"全站弹窗","group":"预留功能","implemented":false}'::jsonb WHERE id='popups.manage';
INSERT INTO electronicclub.schema_migrations(version) VALUES('011-content-media') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
