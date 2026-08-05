-- 角色搜索与目录摘要
-- name: SearchCharactersByName :many
SELECT * FROM character
WHERE enabled_as_guess AND (@q::text = '' OR search_text ILIKE '%' || @q::text || '%')
ORDER BY
    CASE WHEN @direction::text = 'desc' THEN name_sort_key END DESC NULLS LAST,
    CASE WHEN @direction::text <> 'desc' THEN name_sort_key END ASC NULLS LAST,
    id ASC
LIMIT @max_results OFFSET @page_offset;

-- name: SearchCharactersByAppearance :many
SELECT * FROM character
WHERE enabled_as_guess AND (@q::text = '' OR search_text ILIKE '%' || @q::text || '%')
ORDER BY
    CASE WHEN @direction::text = 'desc' THEN appearance_order END DESC NULLS LAST,
    CASE WHEN @direction::text <> 'desc' THEN appearance_order END ASC NULLS LAST,
    id ASC
LIMIT @max_results OFFSET @page_offset;

-- name: CountSearchCharacters :one
SELECT COUNT(*)::bigint AS total FROM character
WHERE enabled_as_guess AND (@q::text = '' OR search_text ILIKE '%' || @q::text || '%');

-- name: GetCatalogCounts :one
SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE enabled_as_guess)::bigint AS guessable,
    COUNT(*) FILTER (WHERE enabled_as_answer)::bigint AS answerable
FROM character;
