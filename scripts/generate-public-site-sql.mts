import { readFile, writeFile } from 'node:fs/promises'
import { PUBLIC_EXPORT_SQL } from '../apps/functions/src/public-site-query'
const sql = `-- Public object-storage export. Additive, idempotent, no account/data resets.
BEGIN;
SELECT pg_advisory_xact_lock(1991,1);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM electronicclub.schema_migrations WHERE version='015-event-operations') THEN RAISE EXCEPTION 'APPLY_015_FIRST'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.ec_public_site_export() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
 PERFORM electronicclub.ec_assert_backend_role();
 ${PUBLIC_EXPORT_SQL} INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'PUBLIC_EXPORT_TOO_LARGE'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ec_public_site_export() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ec_public_site_export() TO service_role;
INSERT INTO electronicclub.schema_migrations(version) VALUES('016-public-site-export') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
`
const file = 'cloudbase/sql/016-public-site-export.sql'
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== sql) throw Error('Public site migration is stale')
} else await writeFile(file, sql)
