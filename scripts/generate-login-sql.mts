import { readFile, writeFile } from 'node:fs/promises'
import { LOGIN_HISTORY_SQL } from '../apps/functions/src/members/login-query'
const sql = `-- Login history: no account, password, role assignment or existing content reset.
BEGIN;
SELECT pg_advisory_xact_lock(1991,1);
CREATE INDEX IF NOT EXISTS login_history_time ON electronicclub.audit_logs((data->>'createdAt') DESC,id) WHERE data->>'action' IN ('auth.login','auth.login_failed','auth.login_blocked');
CREATE INDEX IF NOT EXISTS login_history_member ON electronicclub.audit_logs((coalesce(nullif(data#>>'{login,memberUid}',''),CASE WHEN data->>'action'='auth.login' THEN data->>'actor' END))) WHERE data->>'action' IN ('auth.login','auth.login_failed','auth.login_blocked');
CREATE OR REPLACE FUNCTION public.ec_login_history(p_filter jsonb,p_offset integer,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
PERFORM electronicclub.ec_assert_backend_role();
IF p_filter IS NULL OR jsonb_typeof(p_filter)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_filter) k WHERE k NOT IN ('search','outcome','from','to')) OR EXISTS(SELECT 1 FROM jsonb_each(p_filter) kv WHERE jsonb_typeof(kv.value)<>'string') THEN RAISE EXCEPTION 'INVALID_LOGIN_FILTER'; END IF;
IF p_offset IS NULL OR p_limit IS NULL OR p_offset<0 OR p_limit<1 OR p_limit>50 OR length(coalesce(p_filter->>'search',''))>80 OR coalesce(p_filter->>'outcome','all') NOT IN ('all','success','failure','blocked') THEN RAISE EXCEPTION 'INVALID_LOGIN_PAGE'; END IF;
IF p_filter ? 'from' THEN PERFORM (p_filter->>'from')::timestamptz; END IF;
IF p_filter ? 'to' THEN PERFORM (p_filter->>'to')::timestamptz; END IF;
IF p_filter ? 'from' AND p_filter ? 'to' AND (p_filter->>'from')::timestamptz>=(p_filter->>'to')::timestamptz THEN RAISE EXCEPTION 'INVALID_LOGIN_RANGE'; END IF;
EXECUTE '${LOGIN_HISTORY_SQL.replaceAll("'", "''")}' INTO result USING p_filter,p_limit,p_offset;
RETURN result;END $$;
REVOKE ALL ON FUNCTION public.ec_login_history(jsonb,integer,integer) FROM PUBLIC;
DO $$ DECLARE browser_role text;BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.ec_login_history(jsonb,integer,integer) FROM %I',browser_role); END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.ec_login_history(jsonb,integer,integer) TO service_role;
-- Erase stored network/device metadata atomically when an existing member is anonymized.
CREATE OR REPLACE FUNCTION electronicclub.ec_login_anonymize() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
UPDATE electronicclub.audit_logs SET data=data-'login'
WHERE data ? 'login' AND data->>'action' IN ('auth.login','auth.login_failed','auth.login_blocked')
AND coalesce(nullif(data#>>'{login,memberUid}',''),CASE WHEN data->>'action'='auth.login' THEN data->>'actor' END)=NEW.id;
RETURN NEW;END $$;
REVOKE ALL ON FUNCTION electronicclub.ec_login_anonymize() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION electronicclub.ec_login_anonymize() TO service_role;
DROP TRIGGER IF EXISTS login_history_anonymize ON electronicclub.users;
CREATE TRIGGER login_history_anonymize AFTER UPDATE OF data ON electronicclub.users FOR EACH ROW
WHEN (NEW.data->>'anonymizedAt' IS NOT NULL AND (OLD.data->>'anonymizedAt') IS DISTINCT FROM (NEW.data->>'anonymizedAt')) EXECUTE FUNCTION electronicclub.ec_login_anonymize();
INSERT INTO electronicclub.permissions(id,data) VALUES('security.logins.read','{"id":"security.logins.read","name":"登录记录查询","group":"账号与安全","implemented":true}'::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data;
INSERT INTO electronicclub.schema_migrations(version) VALUES('012-login-history') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
`
const file = 'cloudbase/sql/012-login-history.sql'
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8')) !== sql)
    throw new Error('Login history migration is stale')
} else await writeFile(file, sql)
