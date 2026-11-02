-- Read-only metadata; inspect results privately. Do not paste result data in public logs.
SELECT current_user, current_database(), version();
SELECT nspname FROM pg_namespace WHERE nspname='electronicclub';
SELECT table_name,column_name,data_type FROM information_schema.columns
 WHERE table_schema='electronicclub' ORDER BY table_name,ordinal_position;
-- CREATE ROLE / GRANT may require a provider administrator, not the SQL Editor role.
-- This read-only query does NOT establish that you may create roles or use TCP.
SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=current_user;
