-- Read-only deployment diagnosis. No member details, image data or credentials.
-- Run in the existing CloudBase SQL Editor. Does not repair/delete any row.
BEGIN READ ONLY;
SELECT id AS database_id,
       data->>'id' AS content_id,
       (data->>'id' IS NOT DISTINCT FROM id) AS ids_match,
       coalesce(length(data->>'cover'),0) AS cover_chars,
       data->>'updatedAt' AS updated_at
FROM electronicclub.events
ORDER BY data->>'updatedAt' DESC NULLS LAST, id LIMIT 100;

SELECT 'events' AS collection, count(*) AS inconsistent_ids
FROM electronicclub.events WHERE data->>'id' IS DISTINCT FROM id
UNION ALL
SELECT 'articles', count(*) FROM electronicclub.articles
WHERE data->>'id' IS DISTINCT FROM id;

-- Catalog key vs returned content ID determines which record the UI edits.
SELECT item.value AS catalog_key, e.data->>'id' AS content_id,
       (e.id IS NOT NULL) AS row_exists,
       (e.data->>'id' IS NOT DISTINCT FROM item.value) AS ids_match
FROM electronicclub.system s
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(s.data->'events','[]'::jsonb)) item(value)
LEFT JOIN electronicclub.events e ON e.id=item.value
WHERE s.id='stage3_catalog'
LIMIT 100;
ROLLBACK;
