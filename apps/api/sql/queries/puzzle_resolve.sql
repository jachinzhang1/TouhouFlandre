-- 单人 resolve 幂等记录。记录只绑定公开 session 引用，不存答案。
-- name: InsertPuzzleResolveIdempotency :one
INSERT INTO puzzle_resolve_idempotency (
    idempotency_key, request_fingerprint, mode
) VALUES (@idempotency_key, @request_fingerprint, @mode)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING idempotency_key, request_fingerprint, mode, session_id, resolution,
          superseded_session_id, created_at, expires_at;

-- name: GetPuzzleResolveIdempotencyForUpdate :one
SELECT idempotency_key, request_fingerprint, mode, session_id, resolution,
       superseded_session_id, created_at, expires_at
FROM puzzle_resolve_idempotency
WHERE idempotency_key = @idempotency_key
FOR UPDATE;

-- name: CompletePuzzleResolveIdempotency :exec
UPDATE puzzle_resolve_idempotency
SET session_id = @session_id,
    resolution = @resolution,
    superseded_session_id = @superseded_session_id
WHERE idempotency_key = @idempotency_key;

-- name: ReuseExpiredPuzzleResolveIdempotency :exec
UPDATE puzzle_resolve_idempotency
SET request_fingerprint = @request_fingerprint,
    mode = @mode,
    session_id = NULL,
    resolution = NULL,
    superseded_session_id = NULL,
    created_at = now(),
    expires_at = 'infinity'::timestamptz
WHERE idempotency_key = @idempotency_key
  AND expires_at <= now();

-- name: GetSessionForUpdate :one
SELECT id, mode, content_type, answer_id, catalog_version, puzzle_key, status,
       max_guesses, guesses, version, started_at, ended_at, created_at,
       updated_at, question_scope, answer_match_policy
FROM game_session
WHERE id = @id
FOR UPDATE;
