BEGIN;
-- Additive native tables only. Does not touch pgdoc collections or existing member/role rows.
CREATE TABLE IF NOT EXISTS electronicclub.events(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
CREATE TABLE IF NOT EXISTS electronicclub.event_managers(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
CREATE TABLE IF NOT EXISTS electronicclub.registrations(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
CREATE TABLE IF NOT EXISTS electronicclub.checkins(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
CREATE TABLE IF NOT EXISTS electronicclub.articles(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
CREATE TABLE IF NOT EXISTS electronicclub.popup_announcements(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
CREATE TABLE IF NOT EXISTS electronicclub.popup_state(id text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')); 
ALTER TABLE electronicclub.registrations ADD COLUMN IF NOT EXISTS event_id text GENERATED ALWAYS AS (data->>'eventId') STORED;
ALTER TABLE electronicclub.registrations ADD COLUMN IF NOT EXISTS member_uid text GENERATED ALWAYS AS (data->>'uid') STORED;
CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_member ON electronicclub.registrations(event_id,member_uid);
ALTER TABLE electronicclub.checkins ADD COLUMN IF NOT EXISTS event_id text GENERATED ALWAYS AS (data->>'eventId') STORED;
ALTER TABLE electronicclub.checkins ADD COLUMN IF NOT EXISTS member_uid text GENERATED ALWAYS AS (data->>'uid') STORED;
CREATE UNIQUE INDEX IF NOT EXISTS checkins_event_member ON electronicclub.checkins(event_id,member_uid);
ALTER TABLE electronicclub.event_managers ADD COLUMN IF NOT EXISTS event_id text GENERATED ALWAYS AS (data->>'eventId') STORED;
ALTER TABLE electronicclub.event_managers ADD COLUMN IF NOT EXISTS member_uid text GENERATED ALWAYS AS (data->>'uid') STORED;
CREATE UNIQUE INDEX IF NOT EXISTS event_managers_event_member ON electronicclub.event_managers(event_id,member_uid);

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='registrations_event_id_stage3_fk' AND conrelid='electronicclub.registrations'::regclass) THEN ALTER TABLE electronicclub.registrations ADD CONSTRAINT registrations_event_id_stage3_fk FOREIGN KEY(event_id) REFERENCES electronicclub.events(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='registrations_member_uid_stage3_fk' AND conrelid='electronicclub.registrations'::regclass) THEN ALTER TABLE electronicclub.registrations ADD CONSTRAINT registrations_member_uid_stage3_fk FOREIGN KEY(member_uid) REFERENCES electronicclub.users(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='checkins_id_stage3_fk' AND conrelid='electronicclub.checkins'::regclass) THEN ALTER TABLE electronicclub.checkins ADD CONSTRAINT checkins_id_stage3_fk FOREIGN KEY(id) REFERENCES electronicclub.registrations(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='event_managers_event_id_stage3_fk' AND conrelid='electronicclub.event_managers'::regclass) THEN ALTER TABLE electronicclub.event_managers ADD CONSTRAINT event_managers_event_id_stage3_fk FOREIGN KEY(event_id) REFERENCES electronicclub.events(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='event_managers_member_uid_stage3_fk' AND conrelid='electronicclub.event_managers'::regclass) THEN ALTER TABLE electronicclub.event_managers ADD CONSTRAINT event_managers_member_uid_stage3_fk FOREIGN KEY(member_uid) REFERENCES electronicclub.users(id); END IF; END $$;
CREATE INDEX IF NOT EXISTS events_stage3_lookup ON electronicclub.events((data->>'status'),(data->>'publishedAt') DESC);
CREATE INDEX IF NOT EXISTS articles_stage3_lookup ON electronicclub.articles((data->>'status'),(data->>'category'),(data->>'publishedAt') DESC);
CREATE INDEX IF NOT EXISTS registrations_stage3_lookup ON electronicclub.registrations(event_id,(data->>'status'),(data->'snapshot'->>'college'),(data->'snapshot'->>'className'));
CREATE INDEX IF NOT EXISTS checkins_stage3_lookup ON electronicclub.checkins(event_id);
CREATE INDEX IF NOT EXISTS popup_announcements_stage3_lookup ON electronicclub.popup_announcements((data->>'startsAt'),(data->>'expiresAt'));
-- Database invariants supplement service-side scope/time validation.
ALTER TABLE electronicclub.popup_announcements ADD COLUMN IF NOT EXISTS active_slot text GENERATED ALWAYS AS (CASE WHEN data->>'state'='active' THEN 'current' END) STORED;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='popup_single_active' AND conrelid='electronicclub.popup_announcements'::regclass) THEN ALTER TABLE electronicclub.popup_announcements ADD CONSTRAINT popup_single_active UNIQUE(active_slot) DEFERRABLE INITIALLY DEFERRED; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='popup_state_singleton' AND conrelid='electronicclub.popup_state'::regclass) THEN ALTER TABLE electronicclub.popup_state ADD CONSTRAINT popup_state_singleton CHECK(id='current'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='registrations_identity_valid' AND conrelid='electronicclub.registrations'::regclass) THEN ALTER TABLE electronicclub.registrations ADD CONSTRAINT registrations_identity_valid CHECK((event_id IS NOT NULL AND member_uid IS NOT NULL AND id=event_id||':'||member_uid AND data->>'id'=id) IS TRUE); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='checkins_identity_valid' AND conrelid='electronicclub.checkins'::regclass) THEN ALTER TABLE electronicclub.checkins ADD CONSTRAINT checkins_identity_valid CHECK((event_id IS NOT NULL AND member_uid IS NOT NULL AND id=event_id||':'||member_uid AND data->>'id'=id) IS TRUE); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='event_managers_identity_valid' AND conrelid='electronicclub.event_managers'::regclass) THEN ALTER TABLE electronicclub.event_managers ADD CONSTRAINT event_managers_identity_valid CHECK((event_id IS NOT NULL AND member_uid IS NOT NULL AND id=event_id||':'||member_uid) IS TRUE); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='events_capacity_valid' AND conrelid='electronicclub.events'::regclass) THEN ALTER TABLE electronicclub.events ADD CONSTRAINT events_capacity_valid CHECK(((data->>'occupied')::integer>=0 AND (data->'capacity'='null'::jsonb OR (data->>'occupied')::integer<=(data->>'capacity')::integer)) IS TRUE); END IF; END $$;
CREATE OR REPLACE FUNCTION electronicclub.ec_table(p_collection text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p_collection NOT IN ('events','event_managers','registrations','checkins','articles','popup_announcements','popup_state','users','roles','permissions','credentials','sessions','student_ids','audit_logs','import_jobs','login_limits','system','privacy_jobs') THEN RAISE EXCEPTION 'INVALID_COLLECTION'; END IF;
 RETURN format('electronicclub.%I',p_collection);
END $$;
-- Fail closed even if a deployment mistakenly supplies a database superuser key.
CREATE OR REPLACE FUNCTION electronicclub.ec_assert_backend_role() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user <> 'service_role' OR EXISTS
 (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication))
 THEN RAISE EXCEPTION 'UNSAFE_BACKEND_ROLE' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ec_read(p_collection text,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE value jsonb;
BEGIN
 PERFORM electronicclub.ec_assert_backend_role();
 EXECUTE 'SELECT data FROM '||electronicclub.ec_table(p_collection)||' WHERE id=$1' INTO value USING p_id;
 RETURN jsonb_build_object('data',value,'etag',md5(value::text));
END $$;
CREATE OR REPLACE FUNCTION public.ec_commit(p_reads jsonb,p_writes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE item jsonb; value jsonb; role_id text;
BEGIN
 PERFORM electronicclub.ec_assert_backend_role();
 IF jsonb_typeof(p_reads)<>'array' OR jsonb_typeof(p_writes)<>'array' THEN RAISE EXCEPTION 'INVALID_TRANSACTION'; END IF;
 IF jsonb_array_length(p_reads)>20000 OR jsonb_array_length(p_writes)>20000 THEN RAISE EXCEPTION 'TRANSACTION_TOO_LARGE'; END IF;
 PERFORM pg_advisory_xact_lock(1991,1);
 FOR item IN SELECT * FROM jsonb_array_elements(p_reads) LOOP
  value:=NULL;
  EXECUTE 'SELECT data FROM '||electronicclub.ec_table(item->>'collection')||' WHERE id=$1' INTO value USING item->>'id';
  IF md5(value::text) IS DISTINCT FROM item->>'etag' THEN RETURN jsonb_build_object('ok',false,'conflict',true); END IF;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(p_writes) LOOP
  IF item->'data'='null'::jsonb THEN
   EXECUTE 'DELETE FROM '||electronicclub.ec_table(item->>'collection')||' WHERE id=$1' USING item->>'id';
  ELSE
   EXECUTE 'INSERT INTO '||electronicclub.ec_table(item->>'collection')||'(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data' USING item->>'id',item->'data';
   IF item->>'collection'='users' THEN
    DELETE FROM electronicclub.user_roles WHERE user_id=item->>'id';
    FOR role_id IN SELECT jsonb_array_elements_text(item->'data'->'roleIds') LOOP
     INSERT INTO electronicclub.user_roles(user_id,role_id) VALUES(item->>'id',role_id);
    END LOOP;
   END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION public.ec_list(p_collection text,p_filter jsonb,p_offset integer,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM electronicclub.ec_assert_backend_role();
 IF jsonb_typeof(p_filter)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_filter) k WHERE k NOT IN ('status','_notDeleted','college','className','roleIds','owner','uid','_search')) THEN RAISE EXCEPTION 'INVALID_FILTER'; END IF;
 IF p_offset<0 OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'INVALID_PAGE'; END IF;
 EXECUTE 'WITH filtered AS (SELECT id,data FROM '||electronicclub.ec_table(p_collection)||' WHERE
 (NOT $1 ? ''status'' OR data->>''status''=$1->>''status'') AND
 (NOT $1 ? ''_notDeleted'' OR data->>''status''<>''deleted'') AND
 (NOT $1 ? ''college'' OR data->>''college''=$1->>''college'') AND
 (NOT $1 ? ''className'' OR data->>''className''=$1->>''className'') AND
 (NOT $1 ? ''roleIds'' OR data->''roleIds'' @> jsonb_build_array($1->>''roleIds'')) AND
 (NOT $1 ? ''uid'' OR data->>''uid''=$1->>''uid'') AND
 (NOT $1 ? ''owner'' OR data->>''owner''=$1->>''owner'') AND
 (NOT $1 ? ''_search'' OR strpos(upper(data->>''studentId''),upper($1->>''_search''))>0 OR strpos(upper(data->>''name''),upper($1->>''_search''))>0 OR strpos(upper(data->>''nickname''),upper($1->>''_search''))>0)
 ) SELECT jsonb_build_object(''total'',(SELECT count(*) FROM filtered),''items'',COALESCE((SELECT jsonb_agg(data) FROM (SELECT data FROM filtered ORDER BY data->>''createdAt'' DESC,id LIMIT $2 OFFSET $3) paged),''[]''::jsonb))' INTO result USING p_filter,p_limit,p_offset;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION electronicclub.ec_assert_backend_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION electronicclub.ec_assert_backend_role() TO service_role;
REVOKE ALL ON FUNCTION electronicclub.ec_table(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ec_read(text,text),public.ec_list(text,jsonb,integer,integer),public.ec_commit(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION electronicclub.ec_table(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ec_read(text,text),public.ec_list(text,jsonb,integer,integer),public.ec_commit(jsonb,jsonb) TO service_role;
-- Never GRANT these low-level data functions to anon or ordinary authenticated clients.
-- Managed mode accepts only the existing service_role, never a schema-owner/browser fallback.
NOTIFY pgrst,'reload schema';

REVOKE ALL ON electronicclub.events FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.events TO service_role;
REVOKE ALL ON electronicclub.event_managers FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.event_managers TO service_role;
REVOKE ALL ON electronicclub.registrations FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.registrations TO service_role;
REVOKE ALL ON electronicclub.checkins FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.checkins TO service_role;
REVOKE ALL ON electronicclub.articles FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.articles TO service_role;
REVOKE ALL ON electronicclub.popup_announcements FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.popup_announcements TO service_role;
REVOKE ALL ON electronicclub.popup_state FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.popup_state TO service_role;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.create','{"id": "events.create", "name": "创建活动", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.edit','{"id": "events.edit", "name": "编辑全部活动/分配负责人", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.delete','{"id": "events.delete", "name": "删除活动", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.registrations.read','{"id": "events.registrations.read", "name": "查询报名名单", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.registrations.review','{"id": "events.registrations.review", "name": "审核报名", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.registrations.export','{"id": "events.registrations.export", "name": "导出报名名单", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('events.checkin.manage','{"id": "events.checkin.manage", "name": "管理签到", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('articles.create','{"id": "articles.create", "name": "创建文章", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('articles.edit','{"id": "articles.edit", "name": "编辑文章", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('articles.publish','{"id": "articles.publish", "name": "发布/撤回文章", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('articles.delete','{"id": "articles.delete", "name": "删除文章", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.permissions(id,data) VALUES('announcements.popup.manage','{"id": "announcements.popup.manage", "name": "全站弹窗管理", "group": "第三阶段", "implemented": true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.schema_migrations(version) VALUES('008-stage3') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
