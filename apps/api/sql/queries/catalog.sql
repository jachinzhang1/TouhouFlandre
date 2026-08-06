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
-- 完整可猜角色表（客户端本地搜索缓存源）：与猜测校验集一致（enabled_as_guess），
-- 按名称排序键输出（名称排序与服务器 ILIKE 搜索一致）。
SELECT * FROM character WHERE enabled_as_guess ORDER BY name_sort_key, id ASC;

-- name: ListWorks :many
SELECT
    id,
    title_zh,
    title_ja,
    title_en,
    short_name,
    type,
    release_year,
    mainline_index,
    era,
    created_at,
    updated_at
FROM work
ORDER BY release_year ASC, mainline_index ASC NULLS LAST, short_name ASC, id ASC;
