-- Read-only existence check. Does not read member profiles, passwords or sessions.
-- NULL means the corresponding schema/table/RPC is not installed in this database.
SELECT
  to_regnamespace('electronicclub') AS club_schema,
  to_regclass('electronicclub.users') AS users_table,
  to_regclass('electronicclub.system') AS system_table,
  to_regprocedure('public.ec_read(text,text)') AS rpc_read,
  to_regprocedure('public.ec_commit(jsonb,jsonb)') AS rpc_commit,
  to_regprocedure('public.ec_list(text,jsonb,integer,integer)') AS rpc_list;
-- A non-NULL result proves existence only, not the function runtime's IAM/SQL permissions.
