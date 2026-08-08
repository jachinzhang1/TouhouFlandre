-- +goose Up

ALTER TABLE multi_room
    ADD COLUMN mode text NOT NULL DEFAULT 'race',
    ADD COLUMN turn_seconds integer NOT NULL DEFAULT 60;

ALTER TABLE multi_room
    ADD CONSTRAINT multi_room_mode_check CHECK (mode IN ('race', 'relay')),
    ADD CONSTRAINT multi_room_turn_seconds_check CHECK (turn_seconds IN (30, 60, 90, 120));

ALTER TABLE multi_round
    ADD COLUMN turn_slot integer CHECK (turn_slot IN (1, 2)),
    ADD COLUMN turn_deadline timestamptz;

CREATE TABLE multi_turn (
    id               text PRIMARY KEY,
    round_id         text NOT NULL REFERENCES multi_round (id) ON DELETE CASCADE,
    member_id        text NOT NULL REFERENCES multi_member (id) ON DELETE CASCADE,
    turn_index       integer NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('guess', 'timeout', 'pass')),
    guess_id         text,
    statuses         jsonb,
    is_correct       boolean NOT NULL DEFAULT false,
    idempotency_key  text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (round_id, turn_index),
    UNIQUE (round_id, member_id, idempotency_key),
    UNIQUE (round_id, guess_id),
    CHECK (
        (kind = 'guess' AND guess_id IS NOT NULL AND statuses IS NOT NULL AND idempotency_key IS NOT NULL)
        OR
        (kind IN ('timeout', 'pass') AND guess_id IS NULL AND statuses IS NULL AND idempotency_key IS NULL AND is_correct = false)
    ),
    CHECK (
        statuses IS NULL
        OR (jsonb_typeof(statuses) = 'array' AND jsonb_array_length(statuses) = 6)
    )
);
CREATE INDEX multi_turn_round_idx ON multi_turn (round_id, turn_index);
CREATE INDEX multi_turn_round_member_idx ON multi_turn (round_id, member_id, turn_index);

-- +goose Down

DROP TABLE multi_turn;
ALTER TABLE multi_round
    DROP COLUMN turn_deadline,
    DROP COLUMN turn_slot;
ALTER TABLE multi_room
    DROP CONSTRAINT multi_room_turn_seconds_check,
    DROP CONSTRAINT multi_room_mode_check;
ALTER TABLE multi_room
    DROP COLUMN turn_seconds,
    DROP COLUMN mode;
