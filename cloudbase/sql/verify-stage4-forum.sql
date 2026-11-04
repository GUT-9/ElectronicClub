-- Read-only verification. No personal fields or image payloads.
BEGIN READ ONLY;
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='009-stage4-forum';
SELECT table_name FROM information_schema.tables WHERE table_schema='electronicclub' AND table_name LIKE 'forum_%' ORDER BY table_name;
SELECT id,data->>'name' AS name,data->>'status' AS status,data->>'requireReview' AS review FROM electronicclub.forum_boards ORDER BY (data->>'position')::int,id;
SELECT id,data->>'name' AS permission FROM electronicclub.permissions WHERE id LIKE 'forum.%' ORDER BY id;
SELECT conrelid::regclass AS table_name,conname,contype FROM pg_constraint WHERE connamespace='electronicclub'::regnamespace AND conrelid::regclass::text LIKE '%forum_%' ORDER BY conrelid::regclass::text,conname;
SELECT count(*) AS images,coalesce(sum(length(data->>'dataUrl')),0) AS encoded_bytes FROM electronicclub.forum_images;
SELECT data->>'bytes' AS budget_counter FROM electronicclub.system WHERE id='forum:image-storage';
SELECT has_function_privilege('anon','public.ec_forum_list(text,jsonb,integer,integer)','EXECUTE') AS anon_rpc_must_be_false,has_function_privilege('authenticated','public.ec_forum_list(text,jsonb,integer,integer)','EXECUTE') AS member_rpc_must_be_false;
ROLLBACK;
