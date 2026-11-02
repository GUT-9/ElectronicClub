-- Execute as schema owner, separately from the public API role.
-- DBA creates electronicclub_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Assign its password using the provider's secure console, never a committed literal.
REVOKE ALL ON SCHEMA electronicclub FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA electronicclub FROM PUBLIC;
GRANT USAGE ON SCHEMA electronicclub TO electronicclub_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA electronicclub TO electronicclub_api;
REVOKE ALL ON electronicclub.schema_migrations FROM electronicclub_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA electronicclub REVOKE ALL ON TABLES FROM PUBLIC;
-- No grants to anon/authenticated/browser roles. Do not reuse a provider-wide superuser.
