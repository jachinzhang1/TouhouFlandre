-- 目录摘要
-- name: GetCatalogCounts :one
SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE enabled_as_guess)::bigint AS guessable,
    COUNT(*) FILTER (WHERE enabled_as_answer)::bigint AS answerable
FROM character;
