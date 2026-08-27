-- +goose Up
-- Feedback width is owned by the field registry and the match question scope.
-- PostgreSQL only validates the context-free JSON shape and status vocabulary.

ALTER TABLE multi_guess
    DROP CONSTRAINT multi_guess_statuses_check;
ALTER TABLE multi_guess
    ADD CONSTRAINT multi_guess_statuses_check CHECK (
        jsonb_typeof(statuses) = 'array'
        AND statuses <> '[]'::jsonb
        AND statuses <@ '["exact", "partial", "miss", "higher", "lower", "unknown"]'::jsonb
    );

ALTER TABLE multi_turn
    DROP CONSTRAINT multi_turn_statuses_check;
ALTER TABLE multi_turn
    ADD CONSTRAINT multi_turn_statuses_check CHECK (
        statuses IS NULL
        OR (
            jsonb_typeof(statuses) = 'array'
            AND statuses <> '[]'::jsonb
            AND statuses <@ '["exact", "partial", "miss", "higher", "lower", "unknown"]'::jsonb
        )
    );

ALTER TABLE multi_relay_turn
    DROP CONSTRAINT multi_relay_turn_statuses_check;
ALTER TABLE multi_relay_turn
    ADD CONSTRAINT multi_relay_turn_statuses_check CHECK (
        statuses IS NULL
        OR (
            jsonb_typeof(statuses) = 'array'
            AND statuses <> '[]'::jsonb
            AND statuses <@ '["exact", "partial", "miss", "higher", "lower", "unknown"]'::jsonb
        )
    );

-- +goose Down
-- Expand-only rollback: dynamic-width rows must remain readable after an
-- application rollback, so the relaxed constraints stay in place.
SELECT 1;
