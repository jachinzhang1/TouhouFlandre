-- +goose Up
-- MRX-006: complete relay encounter authority and terminal idempotency.
-- Existing relay tables remain backward-readable by the previous binary.

ALTER TABLE multi_relay_encounter
    ADD COLUMN IF NOT EXISTS ended_by_member_id text,
    ADD COLUMN IF NOT EXISTS end_idempotency_key text;

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multi_relay_encounter'::regclass
          AND conname = 'multi_relay_encounter_turn_member_fk'
    ) THEN
        ALTER TABLE multi_relay_encounter
            ADD CONSTRAINT multi_relay_encounter_turn_member_fk
            FOREIGN KEY (id, turn_member_id)
            REFERENCES multi_relay_encounter_member (encounter_id, member_id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multi_relay_encounter'::regclass
          AND conname = 'multi_relay_encounter_winner_member_fk'
    ) THEN
        ALTER TABLE multi_relay_encounter
            ADD CONSTRAINT multi_relay_encounter_winner_member_fk
            FOREIGN KEY (id, winner_member_id)
            REFERENCES multi_relay_encounter_member (encounter_id, member_id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multi_relay_encounter'::regclass
          AND conname = 'multi_relay_encounter_ended_by_member_fk'
    ) THEN
        ALTER TABLE multi_relay_encounter
            ADD CONSTRAINT multi_relay_encounter_ended_by_member_fk
            FOREIGN KEY (id, ended_by_member_id)
            REFERENCES multi_relay_encounter_member (encounter_id, member_id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multi_relay_encounter'::regclass
          AND conname = 'multi_relay_encounter_terminal_state_check'
    ) THEN
        ALTER TABLE multi_relay_encounter
            ADD CONSTRAINT multi_relay_encounter_terminal_state_check CHECK (
                (
                    status = 'ended'
                    AND ended_at IS NOT NULL
                    AND outcome IS NOT NULL
                    AND turn_member_id IS NULL
                    AND turn_deadline IS NULL
                )
                OR
                (
                    status <> 'ended'
                    AND ended_at IS NULL
                    AND outcome IS NULL
                    AND winner_member_id IS NULL
                    AND ended_by_member_id IS NULL
                    AND end_idempotency_key IS NULL
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multi_relay_encounter'::regclass
          AND conname = 'multi_relay_encounter_terminal_winner_check'
    ) THEN
        ALTER TABLE multi_relay_encounter
            ADD CONSTRAINT multi_relay_encounter_terminal_winner_check CHECK (
                status <> 'ended'
                OR (outcome IN ('win', 'loss', 'forfeit') AND winner_member_id IS NOT NULL)
                OR (outcome IN ('draw', 'timeout') AND winner_member_id IS NULL)
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multi_relay_encounter'::regclass
          AND conname = 'multi_relay_encounter_forfeit_idempotency_check'
    ) THEN
        ALTER TABLE multi_relay_encounter
            ADD CONSTRAINT multi_relay_encounter_forfeit_idempotency_check CHECK (
                (outcome = 'forfeit' AND ended_by_member_id IS NOT NULL AND end_idempotency_key IS NOT NULL)
                OR (outcome IS DISTINCT FROM 'forfeit' AND ended_by_member_id IS NULL AND end_idempotency_key IS NULL)
            );
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- Expand-only rollback: keep terminal metadata and constraints so an older
-- binary can ignore, but never destroy, encounter history.
SELECT 1;
