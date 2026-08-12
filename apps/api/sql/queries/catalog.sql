-- 题库快照与当前版本
-- name: GetCatalogState :one
SELECT * FROM catalog_state WHERE id = 'current';

-- name: GetSnapshot :one
SELECT * FROM catalog_snapshot WHERE version = @version;

-- name: UpsertSnapshot :exec
INSERT INTO catalog_snapshot (version, characters)
VALUES (@version, @characters)
ON CONFLICT (version) DO UPDATE SET characters = EXCLUDED.characters;

-- name: UpsertCatalogState :exec
INSERT INTO catalog_state (id, current_version)
VALUES ('current', @current_version)
ON CONFLICT (id) DO UPDATE SET current_version = EXCLUDED.current_version, updated_at = now();

-- name: ListGuessCharacters :many
-- 兼容期内保留的完整可猜角色表。
SELECT * FROM character WHERE enabled_as_guess ORDER BY name_sort_key, id ASC;

-- name: ListWorks :many
SELECT * FROM work
ORDER BY release_year ASC, mainline_index ASC NULLS LAST, short_name ASC, id ASC;
