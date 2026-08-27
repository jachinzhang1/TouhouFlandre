-- 会话：创建、查询、乐观锁更新
-- name: CreateSession :one
INSERT INTO game_session (
    id, mode, content_type, answer_id, catalog_version, puzzle_key, status, max_guesses, question_scope,
    answer_match_policy
) VALUES (
    @id, @mode, @content_type, @answer_id, @catalog_version, @puzzle_key, @status, @max_guesses, @question_scope,
    COALESCE(NULLIF(@answer_match_policy::text, ''), 'strict')
)
RETURNING *;

-- name: GetSession :one
SELECT * FROM game_session WHERE id = @id;

-- name: UpdateSessionGuess :one
UPDATE game_session
SET guesses = @guesses::jsonb,
    status = @status,
    ended_at = @ended_at,
    version = version + 1,
    updated_at = now()
WHERE id = @id AND version = @version AND status = 'playing'
RETURNING *;
