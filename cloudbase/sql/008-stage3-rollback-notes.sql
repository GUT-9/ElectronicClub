-- READ-ONLY rollback aid. Restore the previous function ZIP/frontend build first.
-- Preserve stage3 tables, records and audit history; no DROP/TRUNCATE is performed.
-- Do not rerun bootstrap or overwrite users/roles/credentials.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='008-stage3';
-- New RPC allow-list is a compatible superset for legacy member operations.
-- If legacy RPC SQL was restored separately, rerun 008 before enabling stage3 again.
