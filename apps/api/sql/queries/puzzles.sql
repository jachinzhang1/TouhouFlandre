-- 每日题
-- name: GetDailyPuzzle :one
SELECT * FROM daily_puzzle WHERE date_key = @date_key AND difficulty = @difficulty;

-- name: CreateDailyPuzzle :one
INSERT INTO daily_puzzle (date_key, difficulty, catalog_version, answer_id, answer_match_policy)
VALUES (@date_key, @difficulty, @catalog_version, @answer_id, COALESCE(NULLIF(@answer_match_policy::text, ''), 'strict'))
RETURNING *;
