-- Read-only verification. This file does not delete any member.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='014-member-purge';
SELECT id,data FROM electronicclub.permissions WHERE id='members.purge';
SELECT id,data FROM electronicclub.system WHERE id='member_purge';
SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='electronicclub.users'::regclass AND tgname='member_purge' AND NOT tgisinternal;
SELECT r.id,r.data->>'name' AS role_name,r.data->>'super' AS is_super,
 r.data->'permissionIds' @> '["members.purge"]'::jsonb AS explicitly_granted
FROM electronicclub.roles r WHERE r.data->>'super'='true' OR r.data->'permissionIds' @> '["members.purge"]'::jsonb;
SELECT count(*) AS inconsistent_role_counts FROM electronicclub.roles r WHERE (r.data->>'memberCount')::integer<>(SELECT count(*) FROM electronicclub.user_roles ur WHERE ur.role_id=r.id);
SELECT rolname,has_function_privilege(rolname,'electronicclub.ec_member_purge()','EXECUTE') AS may_execute FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role');
