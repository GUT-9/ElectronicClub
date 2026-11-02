-- Optional, DBA only. First obtain the ACTUAL PostgreSQL role mapped to a PRIVATE
-- server API key from the provider's configuration/documentation. Do not guess.
-- If that role is already electronicclub_api, skip this file.
-- Replace only the following placeholder. The unmodified file fails closed.
DO $$
DECLARE backend_role text := 'REPLACE_WITH_VERIFIED_PRIVATE_SERVER_ROLE';
BEGIN
 IF backend_role='REPLACE_WITH_VERIFIED_PRIVATE_SERVER_ROLE' OR lower(backend_role) IN ('anon','anonymous','authenticated','public','postgres') THEN
  RAISE EXCEPTION 'VERIFIED_PRIVATE_ROLE_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=backend_role AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'RESTRICTED_ROLE_REQUIRED';
 END IF;
 EXECUTE format('GRANT electronicclub_api TO %I',backend_role);
END $$;
-- Never issue this grant to a role shared with browser/public client API keys.
