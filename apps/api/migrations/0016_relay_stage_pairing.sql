-- +goose Up
-- MRX-005: persist the optional stage bye separately from settlement rows.
-- Pair assignments remain in relay encounter/member rows; this table is not
-- a generic stage-unit abstraction and does not encode scoring behavior.
CREATE TABLE IF NOT EXISTS multi_relay_stage_bye (
    stage_id  text PRIMARY KEY,
    match_id  text NOT NULL,
    member_id text NOT NULL,
    seat      integer NOT NULL CHECK (seat BETWEEN 1 AND 8),
    CONSTRAINT multi_relay_stage_bye_stage_fk
        FOREIGN KEY (stage_id, match_id)
        REFERENCES multi_relay_stage (id, match_id) ON DELETE CASCADE,
    CONSTRAINT multi_relay_stage_bye_roster_fk
        FOREIGN KEY (match_id, member_id)
        REFERENCES multi_match_player (match_id, member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS multi_relay_stage_bye_match_member_idx
    ON multi_relay_stage_bye (match_id, member_id, stage_id);

-- +goose Down
-- Expand-only rollback: the previous binary ignores this relay-owned table.
-- Production application rollback retains frozen bye assignments.
SELECT 1;
