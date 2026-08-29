-- +goose Up

-- Resolve records contain only request identity and public session references.
-- An infinity expiry keeps them at least as durable as the existing sessions;
-- the maintenance owner may set expires_at before allowing key reuse.
CREATE TABLE puzzle_resolve_idempotency (
    idempotency_key       text PRIMARY KEY,
    request_fingerprint   text NOT NULL,
    mode                  text NOT NULL,
    session_id            text REFERENCES game_session (id) ON DELETE RESTRICT,
    resolution            text,
    superseded_session_id text REFERENCES game_session (id) ON DELETE RESTRICT,
    created_at            timestamptz NOT NULL DEFAULT now(),
    expires_at            timestamptz NOT NULL DEFAULT 'infinity'::timestamptz,
    CHECK (resolution IS NULL OR resolution IN ('created', 'resumed')),
    CHECK ((resolution IS NULL AND session_id IS NULL) OR (resolution IS NOT NULL AND session_id IS NOT NULL))
);

CREATE INDEX puzzle_resolve_idempotency_expires_at_idx
    ON puzzle_resolve_idempotency (expires_at);

-- +goose Down

DROP TABLE puzzle_resolve_idempotency;
