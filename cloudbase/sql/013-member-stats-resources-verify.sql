-- Optional read-only checks; expected version exists, backend grants true, browser grants false.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='013-member-stats-resources';
SELECT to_regclass('electronicclub.club_resources') AS resource_metadata;
SELECT has_function_privilege('service_role','public.ec_member_stats()','EXECUTE') AS backend_stats,
       has_function_privilege('service_role','public.ec_resources_list(jsonb,integer,integer)','EXECUTE') AS backend_resources;
SELECT rolname,has_function_privilege(rolname,'public.ec_member_stats()','EXECUTE') AS stats_allowed,
       has_table_privilege(rolname,'electronicclub.club_resources','SELECT') AS resources_allowed
FROM pg_roles WHERE rolname IN ('anon','authenticated');
SELECT id,data->>'name' AS name FROM electronicclub.permissions WHERE id='resources.manage';
