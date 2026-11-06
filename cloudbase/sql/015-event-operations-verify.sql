-- Read-only. No new event or member is created.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='015-event-operations';
SELECT to_regprocedure('public.ec_event_roster(jsonb,integer,integer)') AS roster_rpc;
SELECT indexname FROM pg_indexes WHERE schemaname='electronicclub' AND indexname='registrations_roster_page';
SELECT rolname,has_function_privilege(rolname,'public.ec_event_roster(jsonb,integer,integer)','EXECUTE') AS allowed FROM pg_roles WHERE rolname IN ('service_role','anon','authenticated');
SELECT e.id,e.data->>'title' AS title,jsonb_array_length(e.data->'managerIds') AS manager_count,(SELECT count(*) FROM electronicclub.event_managers em WHERE em.event_id=e.id) AS manager_links FROM electronicclub.events e WHERE e.data->>'status'<>'deleted' ORDER BY e.data->>'createdAt' DESC LIMIT 20;
