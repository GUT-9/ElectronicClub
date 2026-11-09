-- Read-only; no public export contents or member data are printed.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='016-public-site-export';
SELECT to_regprocedure('public.ec_public_site_export()') AS export_rpc;
SELECT has_function_privilege('service_role','public.ec_public_site_export()','EXECUTE') AS backend_can_export;
SELECT NOT EXISTS (
 SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public.ec_public_site_export()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'
) AS public_execute_revoked;
