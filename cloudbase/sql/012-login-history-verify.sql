-- Optional read-only checks.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='012-login-history';
SELECT to_regprocedure('public.ec_login_history(jsonb,integer,integer)') AS history_rpc;
SELECT has_function_privilege('service_role','public.ec_login_history(jsonb,integer,integer)','EXECUTE') AS backend_allowed;
SELECT rolname,has_function_privilege(rolname,'public.ec_login_history(jsonb,integer,integer)','EXECUTE') AS history_allowed
FROM pg_roles WHERE rolname IN ('anon','authenticated');
SELECT id,data->>'name' AS name,data->>'group' AS permission_group FROM electronicclub.permissions WHERE id='security.logins.read';
SELECT tgname FROM pg_trigger WHERE tgrelid='electronicclub.users'::regclass AND tgname='login_history_anonymize';
