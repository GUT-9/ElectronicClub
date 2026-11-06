import { EXPIRED_MEDIA_SQL } from '../apps/functions/src/media/query'
import { readFile, writeFile } from 'node:fs/promises'
import { permissionDefinitions } from '../apps/functions/src/members/model'
const base = await readFile('cloudbase/sql/009-stage4-forum.sql', 'utf8')
const whitelist = base
  .match(
    /CREATE OR REPLACE FUNCTION electronicclub\.ec_table[\s\S]*?END \$\$;/,
  )![0]
  .replace("'forum_boards'", "'media_images','media_chunks','forum_boards'")
let sql = `-- Additive media storage and permission labels. No user/password/role-assignment changes.
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
${whitelist}
`
// Existing installation has these browser roles; guard role-dependent statements to
// remain compatible with providers that do not precreate them. Never CREATE ROLE.
for (const table of ['media_images', 'media_chunks'])
  sql += `REVOKE ALL ON electronicclub.${table} FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON electronicclub.${table} FROM %I',browser_role); END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON electronicclub.${table} TO service_role;
`
sql += `CREATE OR REPLACE FUNCTION public.ec_media_expired(p_before text,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
PERFORM electronicclub.ec_assert_backend_role();
IF p_before IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'INVALID_MEDIA_QUERY'; END IF;
PERFORM p_before::timestamptz;
EXECUTE '${EXPIRED_MEDIA_SQL.replaceAll("'", "''")}' INTO result USING p_before,p_limit;
RETURN result;END $$;
REVOKE ALL ON FUNCTION public.ec_media_expired(text,integer) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.ec_media_expired(text,integer) FROM %I',browser_role); END LOOP; END $$;
GRANT EXECUTE ON FUNCTION public.ec_media_expired(text,integer) TO service_role;
`
// Freeze 011's original catalogue; newer permissions belong to later migrations.
for (const p of permissionDefinitions.filter(
  (p) => !['security.logins.read', 'resources.manage'].includes(p.id),
))
  sql += `UPDATE electronicclub.permissions SET data=data||'${JSON.stringify(p).replaceAll("'", "''")}'::jsonb WHERE id='${p.id}';\n`
sql += `INSERT INTO electronicclub.schema_migrations(version) VALUES('011-content-media') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
`
const file = 'cloudbase/sql/011-content-media.sql'
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8')) !== sql)
    throw new Error('Media migration is stale')
} else await writeFile(file, sql)
