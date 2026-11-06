import { readFile, writeFile } from 'node:fs/promises'
import { EVENT_ROSTER_SQL } from '../apps/functions/src/stage3/roster-query'
const sql = `-- Event roster pagination. Additive and repeatable; no account, password or business data changes.
BEGIN;
SELECT pg_advisory_xact_lock(1991,1);
DO $$ BEGIN IF to_regclass('electronicclub.registrations') IS NULL THEN RAISE EXCEPTION 'APPLY_STAGE3_FIRST'; END IF; END $$;
CREATE INDEX IF NOT EXISTS registrations_roster_page ON electronicclub.registrations(event_id,(data->>'registeredAt') DESC,id);
CREATE OR REPLACE FUNCTION public.ec_event_roster(p_filter jsonb,p_offset integer,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
PERFORM electronicclub.ec_assert_backend_role();
IF p_filter IS NULL OR jsonb_typeof(p_filter)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_filter) k WHERE k NOT IN ('eventId','search','college','className','status','checkedIn')) OR EXISTS(SELECT 1 FROM jsonb_each(p_filter) kv WHERE jsonb_typeof(kv.value)<>'string' OR length(kv.value#>>'{}')>100) THEN RAISE EXCEPTION 'INVALID_ROSTER_FILTER'; END IF;
IF coalesce(p_filter->>'eventId','')!~'^[a-fA-F0-9-]{36}$' OR p_offset IS NULL OR p_limit IS NULL OR p_offset<0 OR p_limit<1 OR p_limit>100 OR coalesce(p_filter->>'status','') NOT IN ('','pending','approved','rejected','cancelled','manual') OR coalesce(p_filter->>'checkedIn','') NOT IN ('','yes','no') THEN RAISE EXCEPTION 'INVALID_ROSTER_PAGE'; END IF;
EXECUTE '${EVENT_ROSTER_SQL.replaceAll("'", "''")}' INTO result USING p_filter,p_limit,p_offset;
RETURN result;END $$;
REVOKE ALL ON FUNCTION public.ec_event_roster(jsonb,integer,integer) FROM PUBLIC;
DO $$ DECLARE browser_role text;BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.ec_event_roster(jsonb,integer,integer) FROM %I',browser_role);END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.ec_event_roster(jsonb,integer,integer) TO service_role;
INSERT INTO electronicclub.schema_migrations(version) VALUES('015-event-operations') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
`
const file = 'cloudbase/sql/015-event-operations.sql'
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8')) !== sql)
    throw new Error('Event operations migration is stale')
} else await writeFile(file, sql)
