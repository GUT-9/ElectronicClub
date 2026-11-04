-- Optional read-only checks after 011-content-media.sql.
SELECT version,applied_at FROM electronicclub.schema_migrations WHERE version='011-content-media';
SELECT to_regclass('electronicclub.media_images') AS images,to_regclass('electronicclub.media_chunks') AS chunks;
SELECT has_table_privilege('service_role','electronicclub.media_images','SELECT,INSERT,UPDATE,DELETE') AS backend_allowed;
SELECT rolname,has_table_privilege(rolname,'electronicclub.media_images','SELECT') AS can_read_images
FROM pg_roles WHERE rolname IN ('anon','authenticated');
SELECT data->>'group' AS permission_group,count(*) FROM electronicclub.permissions GROUP BY data->>'group' ORDER BY permission_group;
SELECT count(*) AS invalid_sizes FROM electronicclub.media_images WHERE (data->>'bytes')::integer>51200;
