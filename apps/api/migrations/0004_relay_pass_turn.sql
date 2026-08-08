-- +goose Up

-- +goose StatementBegin
DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'multi_turn'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%kind%'
          AND pg_get_constraintdef(oid) LIKE '%timeout%'
    LOOP
        EXECUTE format('ALTER TABLE multi_turn DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;
-- +goose StatementEnd

ALTER TABLE multi_turn
    ADD CONSTRAINT multi_turn_kind_check CHECK (kind IN ('guess', 'timeout', 'pass')),
    ADD CONSTRAINT multi_turn_payload_check CHECK (
        (kind = 'guess' AND guess_id IS NOT NULL AND statuses IS NOT NULL AND idempotency_key IS NOT NULL)
        OR
        (kind IN ('timeout', 'pass') AND guess_id IS NULL AND statuses IS NULL AND idempotency_key IS NULL AND is_correct = false)
    );

-- +goose Down

-- +goose StatementBegin
DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'multi_turn'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%kind%'
          AND pg_get_constraintdef(oid) LIKE '%pass%'
    LOOP
        EXECUTE format('ALTER TABLE multi_turn DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;
-- +goose StatementEnd

ALTER TABLE multi_turn
    ADD CONSTRAINT multi_turn_kind_check CHECK (kind IN ('guess', 'timeout')),
    ADD CONSTRAINT multi_turn_payload_check CHECK (
        (kind = 'guess' AND guess_id IS NOT NULL AND statuses IS NOT NULL AND idempotency_key IS NOT NULL)
        OR
        (kind = 'timeout' AND guess_id IS NULL AND statuses IS NULL AND idempotency_key IS NULL AND is_correct = false)
    );
