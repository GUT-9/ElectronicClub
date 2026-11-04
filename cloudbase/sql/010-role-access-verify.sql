-- Read-only checks after 010-role-access.sql; execute as SQL editor owner.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='010-role-access';
SELECT to_regprocedure('public.ec_access_members(jsonb,integer,integer)') AS access_rpc;
SELECT has_function_privilege('service_role','public.ec_access_members(jsonb,integer,integer)','EXECUTE') AS backend_allowed,
       has_function_privilege('anon','public.ec_access_members(jsonb,integer,integer)','EXECUTE') AS anonymous_allowed,
       has_function_privilege('authenticated','public.ec_access_members(jsonb,integer,integer)','EXECUTE') AS browser_allowed;
SELECT count(*) AS inconsistent_assignments FROM electronicclub.users u
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.data->'roleIds') r WHERE NOT EXISTS (SELECT 1 FROM electronicclub.user_roles ur WHERE ur.user_id=u.id AND ur.role_id=r));
