-- Login history: no account, password, role assignment or existing content reset.
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
EXECUTE 'WITH records AS (SELECT a.id,a.data->>''createdAt'' AS at,
 jsonb_build_object(''id'',a.id,''createdAt'',a.data->>''createdAt'',''memberUid'',coalesce(nullif(a.data#>>''{login,memberUid}'',''''),CASE WHEN a.data->>''action''=''auth.login'' THEN a.data->>''actor'' END),''name'',coalesce(u.data->>''name'',''''),''studentId'',coalesce(u.data->>''studentId'',''''),
 ''outcome'',CASE a.data->>''action'' WHEN ''auth.login'' THEN ''success'' WHEN ''auth.login_blocked'' THEN ''blocked'' ELSE ''failure'' END,
 ''reason'',coalesce(a.data#>>''{login,reason}'',''''),''ip'',CASE WHEN (u.data->>''anonymizedAt'' IS NOT NULL) THEN NULL ELSE a.data#>>''{login,ip}'' END,
 ''ipSource'',CASE WHEN (u.data->>''anonymizedAt'' IS NOT NULL) THEN ''unavailable'' ELSE coalesce(a.data#>>''{login,ipSource}'',''legacy'') END,
 ''device'',CASE WHEN (u.data->>''anonymizedAt'' IS NOT NULL) THEN '''' ELSE coalesce(a.data#>>''{login,device}'','''') END,''os'',CASE WHEN (u.data->>''anonymizedAt'' IS NOT NULL) THEN '''' ELSE coalesce(a.data#>>''{login,os}'','''') END,
 ''browser'',CASE WHEN (u.data->>''anonymizedAt'' IS NOT NULL) THEN '''' ELSE coalesce(a.data#>>''{login,browser}'','''') END,''userAgent'',CASE WHEN (u.data->>''anonymizedAt'' IS NOT NULL) THEN '''' ELSE coalesce(a.data#>>''{login,userAgent}'','''') END,
 ''legacy'',NOT(a.data ? ''login''),''anonymized'',coalesce((u.data->>''anonymizedAt'' IS NOT NULL),false)) AS record
 FROM electronicclub.audit_logs a LEFT JOIN electronicclub.users u ON u.id=coalesce(nullif(a.data#>>''{login,memberUid}'',''''),CASE WHEN a.data->>''action''=''auth.login'' THEN a.data->>''actor'' END)
 WHERE a.data->>''action'' IN (''auth.login'',''auth.login_failed'',''auth.login_blocked'')
 AND (NOT $1::jsonb ? ''from'' OR a.data->>''createdAt''>=$1::jsonb->>''from'') AND (NOT $1::jsonb ? ''to'' OR a.data->>''createdAt''<$1::jsonb->>''to'')),
 filtered AS (SELECT * FROM records WHERE (coalesce($1::jsonb->>''outcome'',''all'')=''all'' OR record->>''outcome''=$1::jsonb->>''outcome'') AND strpos(lower(coalesce(record->>''name'','''')||'' ''||coalesce(record->>''studentId'','''')||'' ''||coalesce(record->>''ip'','''')),lower(coalesce($1::jsonb->>''search'','''')))>0),
 paged AS (SELECT * FROM filtered ORDER BY at DESC,id LIMIT $2 OFFSET $3)
 SELECT jsonb_build_object(''total'',(SELECT count(*) FROM filtered),''items'',coalesce((SELECT jsonb_agg(record ORDER BY at DESC,id) FROM paged),''[]''::jsonb)) AS result' INTO result USING p_filter,p_limit,p_offset;
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
