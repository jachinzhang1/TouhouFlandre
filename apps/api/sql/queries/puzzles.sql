-- 每日题
-- name: GetDailyPuzzle :one
SELECT * FROM daily_puzzle WHERE date_key = @date_key;

-- name: CreateDailyPuzzle :one
INSERT INTO daily_puzzle (date_key, catalog_version, answer_id)
VALUES (@date_key, @catalog_version, @answer_id)
RETURNING *;
