-- MRX-003 relay-owned storage queries. These queries are intentionally kept
-- separate from the shared/race query source; the core never interprets them.

-- name: GetRelayStage :one
SELECT * FROM multi_relay_stage WHERE id = $1;

-- name: GetRelayStageForUpdate :one
SELECT * FROM multi_relay_stage WHERE id = $1 FOR UPDATE;

-- name: ListRelayStagesForMatch :many
SELECT *
FROM multi_relay_stage
WHERE match_id = $1
ORDER BY stage_index;

-- name: CreateRelayStage :one
INSERT INTO multi_relay_stage (
    id, match_id, stage_index, status, planned_encounter_count, starts_at
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: MarkRelayStageSettled :one
UPDATE multi_relay_stage
SET status = 'ended',
    settled_at = $2,
    settlement_marker = $3
WHERE id = $1
  AND status <> 'ended'
RETURNING *;

-- name: GetRelayEncounter :one
SELECT * FROM multi_relay_encounter WHERE id = $1;

-- name: GetRelayEncounterForUpdate :one
SELECT * FROM multi_relay_encounter WHERE id = $1 FOR UPDATE;

-- name: ListRelayEncountersForStage :many
SELECT *
FROM multi_relay_encounter
WHERE stage_id = $1
ORDER BY encounter_index, id;

-- name: CreateRelayEncounter :one
INSERT INTO multi_relay_encounter (
    id, match_id, stage_id, encounter_index, status, answer_id,
    starts_at, deadline
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: AddRelayEncounterMember :one
INSERT INTO multi_relay_encounter_member (
    match_id, stage_id, encounter_id, member_id, side, seat
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListRelayEncounterMembers :many
SELECT *
FROM multi_relay_encounter_member
WHERE encounter_id = $1
ORDER BY side, seat, member_id;

-- name: GetRelayEncounterMember :one
SELECT *
FROM multi_relay_encounter_member
WHERE encounter_id = $1 AND member_id = $2;

-- name: CountRelayEncounterMembers :one
SELECT count(*)::int
FROM multi_relay_encounter_member
WHERE encounter_id = $1;

-- name: InsertRelayTurn :one
INSERT INTO multi_relay_turn (
    id, match_id, stage_id, encounter_id, member_id, turn_index, kind,
    guess_id, statuses, is_correct, idempotency_key
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (encounter_id, member_id, idempotency_key) DO NOTHING
RETURNING *;

-- name: GetRelayTurnByIdempotencyKey :one
SELECT *
FROM multi_relay_turn
WHERE encounter_id = $1 AND member_id = $2 AND idempotency_key = $3;

-- name: ListRelayTurnsForEncounter :many
SELECT *
FROM multi_relay_turn
WHERE encounter_id = $1
ORDER BY turn_index;

-- name: CreateRelayMatchPlayerState :one
INSERT INTO multi_relay_match_player_state (
    match_id, member_id, score, life_state, eliminated_stage
)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (match_id, member_id) DO NOTHING
RETURNING *;

-- name: ListRelayMatchPlayerStates :many
SELECT *
FROM multi_relay_match_player_state
WHERE match_id = $1
ORDER BY member_id;

-- name: ListRelayStagePlayers :many
SELECT *
FROM multi_relay_stage_player
WHERE stage_id = $1
ORDER BY member_id;

-- name: InsertRelayStagePlayer :one
INSERT INTO multi_relay_stage_player (
    match_id, stage_id, member_id, encounter_id, assignment, outcome,
    score_before, score_delta, score_after, life_before, life_after,
    eliminated_stage, settled_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;
