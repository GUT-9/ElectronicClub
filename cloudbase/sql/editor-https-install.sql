-- ElectronicClub HTTPS installation. Execute as authorized schema/role owner.
-- Review existing tables before execution. Do NOT split DO/function bodies on semicolons.

-- 001-schema.sql
BEGIN;
CREATE SCHEMA IF NOT EXISTS electronicclub;
CREATE TABLE IF NOT EXISTS electronicclub.schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS electronicclub.users(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.roles(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.permissions(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.credentials(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.sessions(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.student_ids(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.audit_logs(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.import_jobs(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.login_limits(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.system(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
CREATE TABLE IF NOT EXISTS electronicclub.privacy_jobs(id text PRIMARY KEY, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'));
ALTER TABLE electronicclub.users ADD COLUMN IF NOT EXISTS student_id text GENERATED ALWAYS AS (NULLIF(data->>'studentId','')) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS users_student_id_unique ON electronicclub.users(student_id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='student_format' AND conrelid='electronicclub.users'::regclass) THEN
 ALTER TABLE electronicclub.users ADD CONSTRAINT student_format CHECK(jsonb_typeof(data->'studentId') IS NOT DISTINCT FROM 'string' AND (data->>'uid') IS NOT DISTINCT FROM id AND (student_id IS NULL OR (student_id ~ '^[A-Z0-9]{4,24}$' AND student_id !~ '[^A-Z0-9]')));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS electronicclub.user_roles(user_id text REFERENCES electronicclub.users(id) ON DELETE CASCADE,role_id text REFERENCES electronicclub.roles(id),PRIMARY KEY(user_id,role_id));
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='credentials_user_fk' AND conrelid='electronicclub.credentials'::regclass) THEN ALTER TABLE electronicclub.credentials ADD CONSTRAINT credentials_user_fk FOREIGN KEY(id) REFERENCES electronicclub.users(id); END IF; END $$;
ALTER TABLE electronicclub.sessions ADD COLUMN IF NOT EXISTS user_id text GENERATED ALWAYS AS ((data->>'uid')) STORED;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sessions_user_fk' AND conrelid='electronicclub.sessions'::regclass) THEN ALTER TABLE electronicclub.sessions ADD CONSTRAINT sessions_user_fk FOREIGN KEY(user_id) REFERENCES electronicclub.users(id); END IF; END $$;
ALTER TABLE electronicclub.student_ids ADD COLUMN IF NOT EXISTS user_id text GENERATED ALWAYS AS ((data->>'uid')) STORED;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='student_ids_user_fk' AND conrelid='electronicclub.student_ids'::regclass) THEN ALTER TABLE electronicclub.student_ids ADD CONSTRAINT student_ids_user_fk FOREIGN KEY(user_id) REFERENCES electronicclub.users(id); END IF; END $$;
ALTER TABLE electronicclub.privacy_jobs ADD COLUMN IF NOT EXISTS user_id text GENERATED ALWAYS AS ((data->>'uid')) STORED;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='privacy_jobs_user_fk' AND conrelid='electronicclub.privacy_jobs'::regclass) THEN ALTER TABLE electronicclub.privacy_jobs ADD CONSTRAINT privacy_jobs_user_fk FOREIGN KEY(user_id) REFERENCES electronicclub.users(id); END IF; END $$;
INSERT INTO electronicclub.schema_migrations(version) VALUES('001') ON CONFLICT DO NOTHING;
REVOKE ALL ON SCHEMA electronicclub FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA electronicclub FROM PUBLIC;
COMMIT;

-- 002-indexes.sql
BEGIN;
CREATE INDEX IF NOT EXISTS users_status_created ON electronicclub.users((data->>'status'),(data->>'createdAt') DESC,id);
CREATE INDEX IF NOT EXISTS users_college ON electronicclub.users((data->>'college'));
CREATE INDEX IF NOT EXISTS users_class ON electronicclub.users((data->>'className'));
CREATE INDEX IF NOT EXISTS users_roles ON electronicclub.users USING gin((data->'roleIds'));
CREATE INDEX IF NOT EXISTS user_roles_role ON electronicclub.user_roles(role_id);
CREATE INDEX IF NOT EXISTS sessions_user ON electronicclub.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON electronicclub.sessions(((data->>'expiresAt')::bigint));
CREATE INDEX IF NOT EXISTS student_ids_user ON electronicclub.student_ids(user_id);
CREATE INDEX IF NOT EXISTS privacy_user ON electronicclub.privacy_jobs(user_id);
CREATE INDEX IF NOT EXISTS audit_actor ON electronicclub.audit_logs((data->>'actor'),(data->>'createdAt') DESC);
CREATE INDEX IF NOT EXISTS import_owner ON electronicclub.import_jobs((data->>'owner'),(data->>'createdAt') DESC);
COMMIT;

-- Dedicated least-privilege role; no database password or TCP needed for HTTPS.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='electronicclub_api') THEN CREATE ROLE electronicclub_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$;

-- 003-permissions.sql
-- Execute as schema owner, separately from the public API role.
-- DBA creates electronicclub_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Assign its password using the provider's secure console, never a committed literal.
REVOKE ALL ON SCHEMA electronicclub FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA electronicclub FROM PUBLIC;
GRANT USAGE ON SCHEMA electronicclub TO electronicclub_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA electronicclub TO electronicclub_api;
REVOKE ALL ON electronicclub.schema_migrations FROM electronicclub_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA electronicclub REVOKE ALL ON TABLES FROM PUBLIC;
-- No grants to anon/authenticated/browser roles. Do not reuse a provider-wide superuser.

-- 004-http-rpc.sql
BEGIN;
-- Only functions are exposed in public; private data remains in electronicclub.
CREATE OR REPLACE FUNCTION electronicclub.ec_table(p_collection text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p_collection NOT IN ('users','roles','permissions','credentials','sessions','student_ids','audit_logs','import_jobs','login_limits','system','privacy_jobs') THEN RAISE EXCEPTION 'INVALID_COLLECTION'; END IF;
 RETURN format('electronicclub.%I',p_collection);
END $$;
-- Fail closed even if a deployment mistakenly supplies a database superuser key.
CREATE OR REPLACE FUNCTION electronicclub.ec_assert_backend_role() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_has_role(current_user,'electronicclub_api','USAGE') OR EXISTS
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
 IF jsonb_array_length(p_reads)>500 OR jsonb_array_length(p_writes)>500 THEN RAISE EXCEPTION 'TRANSACTION_TOO_LARGE'; END IF;
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
GRANT EXECUTE ON FUNCTION electronicclub.ec_assert_backend_role() TO electronicclub_api;
REVOKE ALL ON FUNCTION electronicclub.ec_table(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ec_read(text,text),public.ec_list(text,jsonb,integer,integer),public.ec_commit(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION electronicclub.ec_table(text) TO electronicclub_api;
GRANT EXECUTE ON FUNCTION public.ec_read(text,text),public.ec_list(text,jsonb,integer,integer),public.ec_commit(jsonb,jsonb) TO electronicclub_api;
-- Never GRANT these low-level data functions to anon or ordinary authenticated clients.
-- If the provider's private server API key uses a different role, DBA must explicitly
-- grant membership/permissions to that verified trusted role. Do not guess role names.
NOTIFY pgrst,'reload schema';
COMMIT;
