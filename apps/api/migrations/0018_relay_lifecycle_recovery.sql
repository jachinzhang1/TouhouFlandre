-- +goose Up
-- MRX-009: relay lifecycle terminal states. This only widens CHECK
-- constraints so existing rows remain backward-readable.

ALTER TABLE multi_relay_encounter
    DROP CONSTRAINT IF EXISTS multi_relay_encounter_outcome_check,
    DROP CONSTRAINT IF EXISTS multi_relay_encounter_terminal_winner_check;

ALTER TABLE multi_relay_encounter
    ADD CONSTRAINT multi_relay_encounter_outcome_check CHECK (
        outcome IN ('win', 'loss', 'draw', 'forfeit', 'timeout', 'server_restart')
    ),
    ADD CONSTRAINT multi_relay_encounter_terminal_winner_check CHECK (
        status <> 'ended'
        OR (outcome IN ('win', 'loss', 'forfeit') AND winner_member_id IS NOT NULL)
        OR (outcome IN ('draw', 'timeout', 'server_restart') AND winner_member_id IS NULL)
    );

-- +goose Down
-- Expand-only rollback: keep the widened terminal state vocabulary so a
-- rollback does not strand already-written lifecycle rows.
SELECT 1;
