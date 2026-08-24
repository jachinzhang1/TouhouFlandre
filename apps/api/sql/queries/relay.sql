-- MRX-003 relay-owned storage queries. These queries are intentionally kept
-- separate from the shared/race query source; the core never interprets them.

-- name: GetRelayStage :one
SELECT * FROM multi_relay_stage WHERE id = $1;

-- name: GetRelayMatch :one
SELECT * FROM multi_match WHERE id = $1;

-- name: GetRelayStageForUpdate :one
SELECT * FROM multi_relay_stage WHERE id = $1 FOR UPDATE;

-- name: GetRelayStageByMatchIndex :one
SELECT *
FROM multi_relay_stage
WHERE match_id = $1 AND stage_index = $2;

-- name: GetRelayStageByMatchIndexForUpdate :one
SELECT *
FROM multi_relay_stage
WHERE match_id = $1 AND stage_index = $2
FOR UPDATE;

-- name: ListRelayStagesForMatch :many
SELECT *
FROM multi_relay_stage
WHERE match_id = $1
ORDER BY stage_index;

-- name: ListRelaySettlementCandidates :many
SELECT stage.id
FROM multi_relay_stage AS stage
WHERE stage.status <> 'ended'
  AND stage.settlement_marker IS NULL
  AND (
      SELECT count(*)
      FROM multi_relay_encounter AS encounter
      WHERE encounter.stage_id = stage.id
  ) = stage.planned_encounter_count
  AND NOT EXISTS (
      SELECT 1
      FROM multi_relay_encounter AS encounter
      WHERE encounter.stage_id = stage.id AND encounter.status <> 'ended'
  )
ORDER BY stage.created_at, stage.id
LIMIT sqlc.arg(candidate_limit);

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

-- name: MarkRelayStagePlaying :one
UPDATE multi_relay_stage
SET status = 'playing'
WHERE id = $1 AND status = 'planned'
RETURNING *;

-- name: CreateRelayStageBye :one
INSERT INTO multi_relay_stage_bye (stage_id, match_id, member_id, seat)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetRelayStageBye :one
SELECT *
FROM multi_relay_stage_bye
WHERE stage_id = $1;

-- name: GetRelayEncounter :one
SELECT * FROM multi_relay_encounter WHERE id = $1;

-- name: GetRelayEncounterForUpdate :one
SELECT * FROM multi_relay_encounter WHERE id = $1 FOR UPDATE;

-- name: GetRelayEncounterTargetForUpdate :one
SELECT encounter.*
FROM multi_relay_encounter AS encounter
JOIN multi_relay_stage AS stage ON stage.id = encounter.stage_id
JOIN multi_match AS match ON match.id = encounter.match_id
WHERE match.room_id = sqlc.arg(room_id)
  AND stage.stage_index = sqlc.arg(stage_index)
  AND encounter.id = sqlc.arg(encounter_id)
FOR UPDATE OF encounter;

-- name: GetRelayEncounterForLegacyRound :one
SELECT encounter.*
FROM multi_relay_encounter AS encounter
JOIN multi_relay_stage AS stage ON stage.id = encounter.stage_id
JOIN multi_match AS match ON match.id = encounter.match_id
WHERE match.room_id = sqlc.arg(room_id)
  AND match.status = 'playing'
  AND stage.stage_index = sqlc.arg(stage_index)
  AND encounter.encounter_index = 1
ORDER BY match.match_index DESC
LIMIT 1;

-- name: GetActiveRelayEncounterForMemberForUpdate :one
SELECT encounter.*
FROM multi_relay_encounter AS encounter
JOIN multi_relay_stage AS stage ON stage.id = encounter.stage_id
JOIN multi_match AS match ON match.id = encounter.match_id
JOIN multi_relay_encounter_member AS member ON member.encounter_id = encounter.id
WHERE match.room_id = sqlc.arg(room_id)
  AND match.status = 'playing'
  AND match.rule_set_key = 'legacy_wins'
  AND match.rule_set_version = 1
  AND match.roster_size = 2
  AND stage.status <> 'ended'
  AND encounter.status <> 'ended'
  AND member.member_id = sqlc.arg(member_id)
ORDER BY stage.stage_index DESC, encounter.encounter_index
LIMIT 1
FOR UPDATE OF encounter;

-- name: ListActiveRelayEncountersForRoomForUpdate :many
SELECT encounter.*
FROM multi_relay_encounter AS encounter
JOIN multi_relay_stage AS stage ON stage.id = encounter.stage_id
JOIN multi_match AS match ON match.id = encounter.match_id
WHERE match.room_id = sqlc.arg(room_id)
  AND match.status = 'playing'
  AND stage.status <> 'ended'
  AND encounter.status <> 'ended'
ORDER BY stage.stage_index, encounter.encounter_index, encounter.id
FOR UPDATE OF encounter;

-- name: ListRelayEncountersForStage :many
SELECT *
FROM multi_relay_encounter
WHERE stage_id = $1
ORDER BY encounter_index, id;

-- name: ListRelayEncountersForMatch :many
SELECT encounter.*
FROM multi_relay_encounter AS encounter
JOIN multi_relay_stage AS stage ON stage.id = encounter.stage_id
WHERE encounter.match_id = $1
ORDER BY stage.stage_index, encounter.encounter_index, encounter.id;

-- name: ListRelayUsedAnswerIDs :many
SELECT answer_id
FROM multi_relay_encounter
WHERE match_id = $1
ORDER BY created_at, id;

-- name: ListRelayEncounterStartCandidates :many
SELECT encounter.id
FROM multi_relay_encounter AS encounter
JOIN multi_match AS match ON match.id = encounter.match_id
WHERE match.status = 'playing'
  AND encounter.status IN ('planned', 'countdown')
  AND encounter.starts_at <= sqlc.arg(now)
ORDER BY encounter.starts_at, encounter.id
LIMIT sqlc.arg(candidate_limit);

-- name: ListRelayEncounterTimeoutCandidates :many
SELECT encounter.id
FROM multi_relay_encounter AS encounter
JOIN multi_match AS match ON match.id = encounter.match_id
WHERE match.status = 'playing'
  AND encounter.status = 'playing'
  AND (
      encounter.deadline <= sqlc.arg(now)
      OR (encounter.turn_deadline IS NOT NULL AND encounter.turn_deadline <= sqlc.arg(now))
  )
ORDER BY LEAST(encounter.deadline, encounter.turn_deadline), encounter.id
LIMIT sqlc.arg(candidate_limit);

-- name: CreateRelayEncounter :one
INSERT INTO multi_relay_encounter (
    id, match_id, stage_id, encounter_index, status, answer_id,
    starts_at, deadline, turn_member_id, turn_deadline
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

-- name: StartRelayEncounter :one
UPDATE multi_relay_encounter
SET status = 'playing'
WHERE id = $1 AND status IN ('planned', 'countdown')
RETURNING *;

-- name: UpdateRelayEncounterTurn :one
UPDATE multi_relay_encounter
SET status = 'playing',
    turn_member_id = sqlc.arg(turn_member_id),
    turn_deadline = sqlc.arg(turn_deadline)
WHERE id = sqlc.arg(id) AND status <> 'ended'
RETURNING *;

-- name: EndRelayEncounter :one
UPDATE multi_relay_encounter
SET status = 'ended',
    turn_member_id = NULL,
    turn_deadline = NULL,
    winner_member_id = sqlc.narg(winner_member_id),
    outcome = sqlc.arg(outcome),
    ended_at = sqlc.arg(ended_at),
    ended_by_member_id = sqlc.narg(ended_by_member_id),
    end_idempotency_key = sqlc.narg(end_idempotency_key)
WHERE id = sqlc.arg(id) AND status <> 'ended'
RETURNING *;

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

-- name: CountRelayTurnsForEncounterMember :one
SELECT count(*)::int
FROM multi_relay_turn
WHERE encounter_id = $1 AND member_id = $2;

-- name: CountRelaySkipsForEncounterMember :one
SELECT count(*)::int
FROM multi_relay_turn
WHERE encounter_id = $1 AND member_id = $2 AND kind IN ('pass', 'timeout');

-- name: CountRelayTurnsForEncounter :one
SELECT count(*)::int
FROM multi_relay_turn
WHERE encounter_id = $1;

-- name: GetRelayGuessForEncounter :one
SELECT *
FROM multi_relay_turn
WHERE encounter_id = $1 AND guess_id = $2 AND kind = 'guess';

-- name: IncrementRelayMatchStageCount :one
UPDATE multi_match
SET round_count = GREATEST(round_count, sqlc.arg(stage_index))
WHERE id = sqlc.arg(match_id)
RETURNING *;

-- name: SyncLegacyRelayPlayerScore :one
UPDATE multi_match_player
SET wins = sqlc.arg(score), score = sqlc.arg(score)
WHERE match_id = sqlc.arg(match_id) AND member_id = sqlc.arg(member_id)
RETURNING *;

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

-- name: UpdateRelayMatchPlayerState :one
UPDATE multi_relay_match_player_state
SET score = sqlc.arg(score),
    life_state = sqlc.arg(life_state),
    eliminated_stage = sqlc.narg(eliminated_stage)
WHERE match_id = sqlc.arg(match_id) AND member_id = sqlc.arg(member_id)
RETURNING *;

-- name: MarkRelayMatchPlayerEliminated :one
UPDATE multi_match_player
SET status = 'eliminated'
WHERE match_id = sqlc.arg(match_id)
  AND member_id = sqlc.arg(member_id)
  AND status = 'active'
RETURNING *;

-- name: MarkRelayMatchPlayerTerminalStage :one
UPDATE multi_relay_match_player_state
SET eliminated_stage = COALESCE(eliminated_stage, sqlc.arg(stage_index))
WHERE match_id = sqlc.arg(match_id)
  AND member_id = sqlc.arg(member_id)
RETURNING *;

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
