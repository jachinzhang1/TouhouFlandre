-- +goose Up
-- MPX-004: expand-only match/round rosters keyed by stable member identity.
-- Legacy slot score/winner columns remain during rollout so an application
-- rollback can keep serving existing two-player rooms without schema loss.

ALTER TABLE multi_match
    ADD COLUMN IF NOT EXISTS winner_member_id text;

ALTER TABLE multi_round
    ADD COLUMN IF NOT EXISTS winner_member_id text;

ALTER TABLE multi_round
    DROP CONSTRAINT IF EXISTS multi_round_winner_slot_check;

ALTER TABLE multi_round
    ADD CONSTRAINT multi_round_winner_slot_check
    CHECK (winner_slot BETWEEN 1 AND 8);

CREATE TABLE IF NOT EXISTS multi_match_player (
    match_id   text NOT NULL REFERENCES multi_match (id) ON DELETE CASCADE,
    member_id  text NOT NULL REFERENCES multi_member (id) ON DELETE CASCADE,
    seat       integer NOT NULL CHECK (seat BETWEEN 1 AND 8),
    wins       integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
    PRIMARY KEY (match_id, member_id),
    UNIQUE (match_id, seat)
);

CREATE INDEX IF NOT EXISTS multi_match_player_member_idx
    ON multi_match_player (member_id, match_id);

CREATE TABLE IF NOT EXISTS multi_round_player (
    round_id   text NOT NULL REFERENCES multi_round (id) ON DELETE CASCADE,
    member_id  text NOT NULL REFERENCES multi_member (id) ON DELETE CASCADE,
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'forfeited')),
    PRIMARY KEY (round_id, member_id)
);

CREATE INDEX IF NOT EXISTS multi_round_player_member_idx
    ON multi_round_player (member_id, round_id);

-- Existing two-player rooms used member.seat as their implicit frozen roster.
INSERT INTO multi_match_player (match_id, member_id, seat, wins, status)
SELECT
    match.id,
    member.id,
    member.seat,
    CASE member.seat
        WHEN 1 THEN match.score_slot1
        WHEN 2 THEN match.score_slot2
        ELSE 0
    END,
    CASE WHEN member.status = 'left' THEN 'left' ELSE 'active' END
FROM multi_match AS match
JOIN multi_member AS member
  ON member.room_id = match.room_id
 AND member.role = 'player'
 AND member.seat BETWEEN 1 AND 2
ON CONFLICT (match_id, member_id) DO NOTHING;

INSERT INTO multi_round_player (round_id, member_id, status)
SELECT round.id, roster.member_id, 'active'
FROM multi_round AS round
JOIN multi_match_player AS roster ON roster.match_id = round.match_id
ON CONFLICT (round_id, member_id) DO NOTHING;

UPDATE multi_round AS round
SET winner_member_id = roster.member_id
FROM multi_match_player AS roster
WHERE roster.match_id = round.match_id
  AND roster.seat = round.winner_slot
  AND round.winner_member_id IS NULL;

-- +goose Down
-- Expand-only rollback: production application rollback must retain roster
-- rows and member-based winner data. Disposable migration tests execute this
-- no-op Down and then prove that Up can be applied again idempotently.
SELECT 1;
