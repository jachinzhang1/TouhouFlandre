-- 多人模式查询（docs/08_multiplayer_mode_design.md §9.3 清单 + 实施所需补充）。
-- 锁序纪律（§9.2）：触碰局/场行的路径统一 局 → 场 → 房间；大厅命令只锁房间行。

-- name: CreateRoom :one
INSERT INTO multi_room (id, code, format, status, expires_at)
VALUES ($1, $2, $3, 'lobby', $4)
RETURNING *;

-- name: GetRoomByCode :one
SELECT * FROM multi_room WHERE code = $1;

-- name: GetRoomByCodeForUpdate :one
-- 加入路径：锁房间行（大厅命令只锁房间行，§9.2 锁序纪律）。
SELECT * FROM multi_room WHERE code = $1 FOR UPDATE;

-- name: GetRoomForUpdate :one
-- 大厅命令（ready/leave/close）锁房间行。
SELECT * FROM multi_room WHERE id = $1 FOR UPDATE;

-- name: IncrementRoomEventSeq :one
-- 事件序号分配器（§9.2 步骤 9：事务内 UPDATE 取号）。
UPDATE multi_room SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq;

-- name: GetRoom :one
SELECT * FROM multi_room WHERE id = $1;

-- name: GetRoomSnapshotState :one
-- 快照单查询组装（§7.3/§9.4）：room/match/round/members + 当前局双方猜测一次取回，
-- 展示组装（名称/头像/标签/列置换）在 Go 投影层按场 catalog_version 快照水合。
WITH latest_match AS (
    SELECT * FROM multi_match WHERE room_id = $1 ORDER BY match_index DESC LIMIT 1
),
active_round AS (
    SELECT r.* FROM multi_round r
    JOIN latest_match lm ON r.match_id = lm.id
    WHERE r.status IN ('countdown', 'playing')
    ORDER BY r.round_index DESC
    LIMIT 1
)
SELECT jsonb_build_object(
    'room',    (SELECT to_jsonb(mr) FROM multi_room mr WHERE mr.id = $1),
    'members', (SELECT COALESCE(jsonb_agg(m ORDER BY m.slot), '[]'::jsonb) FROM multi_member m WHERE m.room_id = $1),
    'match',   (SELECT to_jsonb(lm) FROM latest_match lm),
    'round',   (SELECT to_jsonb(ar) FROM active_round ar),
    'guesses', (SELECT COALESCE(jsonb_agg(g ORDER BY g.member_id, g.sequence), '[]'::jsonb)
                FROM multi_guess g WHERE g.round_id = (SELECT ar.id FROM active_round ar))
)::jsonb AS snapshot;

-- name: UpdateRoomStatus :one
UPDATE multi_room SET status = $2, expires_at = $3 WHERE id = $1 RETURNING *;

-- name: CloseRoom :one
UPDATE multi_room SET status = 'closed', expires_at = $2 WHERE id = $1 RETURNING *;

-- name: DeleteRoom :exec
DELETE FROM multi_room WHERE id = $1;

-- name: CreateMember :one
INSERT INTO multi_member (id, room_id, slot, display_name, token_hash)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetMemberByTokenHash :one
SELECT * FROM multi_member WHERE token_hash = $1;

-- name: ListMembers :many
SELECT * FROM multi_member WHERE room_id = $1 ORDER BY slot;

-- name: ListMembersForRematch :many
SELECT * FROM multi_member WHERE room_id = $1 AND status <> 'left' ORDER BY slot;

-- name: DeleteMember :exec
DELETE FROM multi_member WHERE id = $1;

-- name: UpdateMemberStatus :one
UPDATE multi_member SET status = $2, grace_until = $3 WHERE id = $1 RETURNING *;

-- name: SetMemberReady :one
UPDATE multi_member SET ready = $2 WHERE id = $1 RETURNING *;

-- name: SetMemberRematchReady :one
UPDATE multi_member SET rematch_ready = $2 WHERE id = $1 RETURNING *;

-- name: CreateMatch :one
-- 首场与再来一局共用；事务内算 match_index = MAX+1（无行时 0）。
INSERT INTO multi_match (id, room_id, match_index, catalog_version, target_wins, status, started_at)
SELECT $1, $2, COALESCE(MAX(match_index), -1) + 1, $3, $4, 'playing', $5
FROM multi_match WHERE room_id = $2
RETURNING *;

-- name: GetMatchForUpdate :one
SELECT * FROM multi_match WHERE id = $1 FOR UPDATE;

-- name: GetActiveMatchForUpdate :one
-- 房间当前进行中的场（forfeit/重启终止路径）。
SELECT * FROM multi_match
WHERE room_id = $1 AND status = 'playing'
ORDER BY match_index DESC
LIMIT 1
FOR UPDATE;

-- name: ListActiveMatches :many
-- 全部进行中场（服务重启终止扫描；§4.6 明确终止）。
SELECT * FROM multi_match WHERE status = 'playing' ORDER BY started_at;

-- name: EndMatch :one
UPDATE multi_match SET status = 'finished', ended_at = $2 WHERE id = $1 RETURNING *;

-- name: CreateRound :one
-- 开局事务内 round_count+1 与 3×N 上限检查（§9.2：round_count 的 +1 与上限检查在开局事务内做；
-- max_rounds = factor × N，按赛制计算，bo3 为 9 而非 target_wins×factor=6）。
-- 达到上限（round_count >= max_rounds）时 UPDATE 影响 0 行 → 无 INSERT → 返回 ErrNoRows。
WITH incremented AS (
    UPDATE multi_match
    SET round_count = round_count + 1
    WHERE id = $1 AND round_count < sqlc.arg(max_rounds)
    RETURNING id
)
INSERT INTO multi_round (id, match_id, round_index, answer_id, status, starts_at, deadline)
SELECT $2, $1, $3, $4, 'countdown', $5, $6
FROM incremented
RETURNING *;

-- name: GetRound :one
SELECT * FROM multi_round WHERE id = $1;

-- name: GetRoundForUpdate :one
SELECT * FROM multi_round WHERE id = $1 FOR UPDATE;

-- name: GetCurrentRoundForUpdateByRoom :one
-- 房间当前场（playing）的最新局（countdown|playing|ended 均返回），按 局→场→房间 锁序先锁局行。
SELECT r.* FROM multi_round r
JOIN multi_match m ON m.id = r.match_id
WHERE m.room_id = $1 AND m.status = 'playing'
ORDER BY r.round_index DESC
LIMIT 1
FOR UPDATE OF r;

-- name: GetMatchByIndex :one
-- 按 (room, match_index) 取场（快照事件水合用）。
SELECT * FROM multi_match WHERE room_id = $1 AND match_index = $2;

-- name: StartRound :one
-- countdown → playing（条件更新兜底：sweeper 到点唯一过渡）。
UPDATE multi_round SET status = 'playing' WHERE id = $1 AND status = 'countdown' RETURNING *;

-- name: ListRoundsAwaitingAdvance :many
-- 等待局间推进的局：场仍 playing、该局已 ended、无进行中的新局、间歇已过（intermission）。
SELECT r.*, m.room_id AS room_id
FROM multi_round r
JOIN multi_match m ON m.id = r.match_id
WHERE m.status = 'playing'
  AND r.status = 'ended'
  AND r.ended_at IS NOT NULL
  AND r.ended_at + sqlc.arg(intermission)::interval <= now()
  AND r.round_index = (SELECT MAX(r3.round_index) FROM multi_round r3 WHERE r3.match_id = m.id)
  AND NOT EXISTS (
      SELECT 1 FROM multi_round r2
      WHERE r2.match_id = m.id AND r2.status IN ('countdown', 'playing')
  )
ORDER BY r.ended_at;

-- name: GetActiveRoundForUpdate :one
-- 房间当前进行中的局（countdown|playing；对局中 leave/sweeper 结算取当前局）。
SELECT * FROM multi_round
WHERE match_id = $1 AND status IN ('countdown', 'playing')
ORDER BY round_index DESC
LIMIT 1
FOR UPDATE;

-- name: ListRoundsForMatch :many
SELECT * FROM multi_round WHERE match_id = $1 ORDER BY round_index;

-- name: ListUsedAnswersForMatch :many
SELECT answer_id FROM multi_round WHERE match_id = $1 ORDER BY round_index;

-- name: InsertGuess :one
-- 幂等：ON CONFLICT (round_id, member_id, idempotency_key) DO NOTHING；
-- 0 行 → 按幂等键重读首次结果（GetGuessByIdempotencyKey）；
-- UNIQUE(round_id, member_id, guess_id) 冲突 → 23505 → DUPLICATE_GUESS（handler 层判定）。
INSERT INTO multi_guess (id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (round_id, member_id, idempotency_key) DO NOTHING
RETURNING *;

-- name: GetGuessByIdempotencyKey :one
SELECT * FROM multi_guess WHERE round_id = $1 AND member_id = $2 AND idempotency_key = $3;

-- name: CountGuessesForRoundMember :one
SELECT COUNT(*) FROM multi_guess WHERE round_id = $1 AND member_id = $2;

-- name: ListGuessesForRound :many
SELECT * FROM multi_guess WHERE round_id = $1 ORDER BY member_id, sequence;

-- name: EndRound :one
UPDATE multi_round SET status = 'ended', winner_slot = $2, ended_at = $3 WHERE id = $1 RETURNING *;

-- name: UpdateMatchScore :one
UPDATE multi_match SET score_slot1 = $2, score_slot2 = $3 WHERE id = $1 RETURNING *;

-- name: InsertRoomEvent :one
INSERT INTO room_event (room_id, sequence, type, payload)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListEventsAfterSeq :many
SELECT * FROM room_event WHERE room_id = $1 AND sequence > $2 ORDER BY sequence;

-- name: ListExpiredLobbyRooms :many
SELECT * FROM multi_room WHERE status = 'lobby' AND expires_at < now() ORDER BY expires_at;

-- name: ListExpiredRounds :many
SELECT * FROM multi_round
WHERE (status = 'countdown' AND starts_at <= now())
   OR (status = 'playing' AND deadline <= now())
ORDER BY starts_at;

-- name: ListTimedOutMembers :many
SELECT * FROM multi_member WHERE status = 'disconnected' AND grace_until <= now() ORDER BY grace_until;

-- name: ListFinishedMatches :many
-- finished 展示期（FINISHED_RETENTION）到期的场次 → 关闭房间（room.closed reason=retention）。
SELECT m.*
FROM multi_match m
JOIN multi_room r ON r.id = m.room_id
WHERE m.status = 'finished' AND r.status = 'finished' AND r.expires_at <= now()
ORDER BY m.ended_at;

-- name: ListExpiredClosedRooms :many
SELECT * FROM multi_room WHERE status = 'closed' AND expires_at <= now() ORDER BY expires_at;
