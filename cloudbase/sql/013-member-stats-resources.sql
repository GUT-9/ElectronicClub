-- Additive member activation statistics and Qiniu resource metadata. No account/password reset.
BEGIN;
SELECT pg_advisory_xact_lock(1991,1);
CREATE TABLE IF NOT EXISTS electronicclub.club_resources(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 CONSTRAINT club_resource_identity CHECK((data->>'id'=id) IS TRUE),
 CONSTRAINT club_resource_size CHECK(((data->>'size')::bigint BETWEEN 1 AND 104857600) IS TRUE),
 CONSTRAINT club_resource_status CHECK((data->>'status' IN ('uploading','draft','published','deleting','deleted')) IS TRUE),
 CONSTRAINT club_resource_key CHECK((data->>'key' ~ ('^electronicclub/resources/v1/'||id||'[.][a-z0-9]+$')) IS TRUE),
 owner_uid text GENERATED ALWAYS AS (data->>'ownerUid') STORED NOT NULL REFERENCES electronicclub.users(id));
CREATE INDEX IF NOT EXISTS club_resources_listing ON electronicclub.club_resources((data->>'status'),(data->>'category'),(data->>'createdAt') DESC,id);
CREATE INDEX IF NOT EXISTS club_resources_cleanup ON electronicclub.club_resources((data->>'status'),(data->>'expiresAt'));
CREATE INDEX IF NOT EXISTS member_activation_audit ON electronicclub.audit_logs((data->>'actor'),(data->>'action')) WHERE data->>'action' IN ('auth.login','auth.password_change');
CREATE OR REPLACE FUNCTION electronicclub.ec_table(p_collection text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p_collection NOT IN ('club_resources','media_images','media_chunks','forum_boards','forum_posts','forum_comments','forum_likes','forum_favorites','forum_reports','forum_user_restrictions','forum_notifications','forum_images','events','event_managers','registrations','checkins','articles','popup_announcements','popup_state','users','roles','permissions','credentials','sessions','student_ids','audit_logs','import_jobs','login_limits','system','privacy_jobs') THEN RAISE EXCEPTION 'INVALID_COLLECTION'; END IF;
 RETURN format('electronicclub.%I',p_collection);
END $$;
REVOKE ALL ON electronicclub.club_resources FROM PUBLIC;
DO $$ DECLARE browser_role text;BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON electronicclub.club_resources FROM %I',browser_role);END LOOP;END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.club_resources TO service_role;
CREATE OR REPLACE FUNCTION public.ec_member_stats() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN PERFORM electronicclub.ec_assert_backend_role();
SELECT jsonb_build_object('activeMembers',count(*),'loggedInMembers',count(*) FILTER(WHERE has_login),'activatedMembers',count(*) FILTER(WHERE has_login AND has_password_change AND NOT must_change),'pendingMembers',count(*) FILTER(WHERE NOT(has_login AND has_password_change AND NOT must_change))) INTO result FROM(SELECT u.id,coalesce((u.data->>'mustChangePassword')::boolean,true) AS must_change,EXISTS(SELECT 1 FROM electronicclub.audit_logs a WHERE a.data->>'actor'=u.id AND a.data->>'action'='auth.login') AS has_login,EXISTS(SELECT 1 FROM electronicclub.audit_logs a WHERE a.data->>'actor'=u.id AND a.data->>'action'='auth.password_change') AS has_password_change FROM electronicclub.users u WHERE u.data->>'status'='active' AND u.data->>'anonymizedAt' IS NULL) m;
RETURN result;END $$;
CREATE OR REPLACE FUNCTION public.ec_resources_list(p_filter jsonb,p_offset integer,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN PERFORM electronicclub.ec_assert_backend_role();
IF p_filter IS NULL OR jsonb_typeof(p_filter)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_filter) k WHERE k NOT IN ('public','status','search','category','cleanupBefore','uploadBefore')) OR EXISTS(SELECT 1 FROM jsonb_each(p_filter) kv WHERE jsonb_typeof(kv.value) NOT IN ('string','boolean')) THEN RAISE EXCEPTION 'INVALID_RESOURCE_FILTER';END IF;
IF p_offset IS NULL OR p_limit IS NULL OR p_offset<0 OR p_limit<1 OR p_limit>50 OR length(coalesce(p_filter->>'search',''))>80 OR length(coalesce(p_filter->>'category',''))>40 OR p_filter ? 'status' AND p_filter->>'status' NOT IN ('all','uploading','draft','published','deleting','deleted') THEN RAISE EXCEPTION 'INVALID_RESOURCE_PAGE';END IF;
EXECUTE 'WITH filtered AS (SELECT id,data FROM electronicclub.club_resources WHERE (NOT coalesce(($1::jsonb->>''public'')::boolean,false) OR data->>''status''=''published'') AND (NOT $1::jsonb ? ''status'' OR $1::jsonb->>''status''=''all'' OR data->>''status''=$1::jsonb->>''status'') AND ($1::jsonb ? ''status'' OR data->>''status''<>''deleted'') AND (coalesce($1::jsonb->>''category'','''')='''' OR data->>''category''=$1::jsonb->>''category'') AND strpos(lower(coalesce(data->>''title'','''')||'' ''||coalesce(data->>''description'','''')||'' ''||coalesce(data->>''originalName'','''')),lower(coalesce($1::jsonb->>''search'','''')))>0 AND (NOT $1::jsonb ? ''cleanupBefore'' OR ((data->>''status''=''deleting'' AND data->>''expiresAt''<$1::jsonb->>''cleanupBefore'') OR (data->>''status''=''uploading'' AND data->>''createdAt''<coalesce($1::jsonb->>''uploadBefore'',$1::jsonb->>''cleanupBefore''))))),paged AS (SELECT id,data FROM filtered ORDER BY data->>''createdAt'' DESC,id LIMIT $2 OFFSET $3) SELECT jsonb_build_object(''total'',(SELECT count(*) FROM filtered),''items'',coalesce((SELECT jsonb_agg(data ORDER BY data->>''createdAt'' DESC,id) FROM paged),''[]''::jsonb)) AS result' INTO result USING p_filter,p_limit,p_offset;
RETURN result;END $$;
REVOKE ALL ON FUNCTION public.ec_member_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ec_resources_list(jsonb,integer,integer) FROM PUBLIC;
DO $$ DECLARE browser_role text;BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.ec_member_stats() FROM %I',browser_role);EXECUTE format('REVOKE ALL ON FUNCTION public.ec_resources_list(jsonb,integer,integer) FROM %I',browser_role);END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.ec_member_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.ec_resources_list(jsonb,integer,integer) TO service_role;
INSERT INTO electronicclub.permissions(id,data) VALUES('resources.manage','{"id":"resources.manage","name":"资料上传与管理","group":"社团资料","implemented":true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.schema_migrations(version) VALUES('013-member-stats-resources') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
