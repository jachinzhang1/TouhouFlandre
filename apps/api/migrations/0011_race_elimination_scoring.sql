-- +goose Up
-- MPX-006: expand race matches with frozen scoring mode, standings, and
-- per-round placement data. Legacy columns remain readable during rollout.

ALTER TABLE multi_match
    ADD COLUMN scoring_mode text NOT NULL DEFAULT 'wins',
    ADD COLUMN roster_size integer NOT NULL DEFAULT 2 CHECK (roster_size BETWEEN 2 AND 8),
    ADD COLUMN max_rounds integer NOT NULL DEFAULT 3 CHECK (max_rounds >= 1);

ALTER TABLE multi_match
    ADD CONSTRAINT multi_match_scoring_mode_check
    CHECK (scoring_mode IN ('wins', 'placement'));

UPDATE multi_match AS match
SET roster_size = roster.count,
    max_rounds = CASE room.format
        WHEN 'bo1' THEN 3
        WHEN 'bo3' THEN 9
        WHEN 'bo5' THEN 15
        WHEN 'bo7' THEN 21
        ELSE 3
    END
FROM (
    SELECT match_id, count(*)::integer AS count
    FROM multi_match_player
    GROUP BY match_id
) AS roster,
multi_room AS room
WHERE roster.match_id = match.id
  AND room.id = match.room_id;

ALTER TABLE multi_match_player
    ADD COLUMN score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
    ADD COLUMN best_round_score integer NOT NULL DEFAULT 0 CHECK (best_round_score >= 0),
    ADD COLUMN eliminated_round integer CHECK (eliminated_round >= 1);

UPDATE multi_match_player SET score = wins;

ALTER TABLE multi_match_player
    DROP CONSTRAINT IF EXISTS multi_match_player_status_check;

ALTER TABLE multi_match_player
    ADD CONSTRAINT multi_match_player_status_check
    CHECK (status IN ('active', 'eliminated', 'left'));

ALTER TABLE multi_round_player
    ADD COLUMN finish_rank integer CHECK (finish_rank >= 1),
    ADD COLUMN points_awarded integer NOT NULL DEFAULT 0 CHECK (points_awarded >= 0),
    ADD COLUMN completed_at timestamptz;

ALTER TABLE multi_round_player
    DROP CONSTRAINT IF EXISTS multi_round_player_status_check;

ALTER TABLE multi_round_player
    ADD CONSTRAINT multi_round_player_status_check
    CHECK (status IN ('active', 'correct', 'forfeited', 'exhausted', 'timed_out'));

CREATE INDEX multi_match_player_standings_idx
    ON multi_match_player (match_id, status, score DESC, seat);

-- +goose Down
-- Expand-only rollback: application rollback keeps placement data and the
-- legacy wins columns remain available to the previous binary.
SELECT 1;
