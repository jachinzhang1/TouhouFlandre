-- +goose Up
-- MPX-008: persistent room chat with an independent room position and
-- database-backed member/room token buckets.

ALTER TABLE multi_room
    ADD COLUMN chat_seq bigint NOT NULL DEFAULT 0 CHECK (chat_seq >= 0),
    ADD COLUMN chat_rate_tokens double precision,
    ADD COLUMN chat_rate_refilled_at timestamptz;

ALTER TABLE multi_member
    ADD COLUMN chat_rate_tokens double precision,
    ADD COLUMN chat_rate_refilled_at timestamptz;

CREATE TABLE multi_chat_message (
    id                    text PRIMARY KEY,
    room_id               text NOT NULL REFERENCES multi_room (id) ON DELETE CASCADE,
    position              bigint NOT NULL CHECK (position > 0),
    sender_member_id      text NOT NULL,
    sender_display_name   text NOT NULL,
    sender_role           text NOT NULL CHECK (sender_role IN ('player', 'spectator')),
    sender_seat           integer CHECK (sender_seat > 0),
    client_message_id     uuid NOT NULL,
    kind                  text NOT NULL CHECK (kind IN ('text', 'emoji')),
    content               text NOT NULL,
    channel               text NOT NULL CHECK (channel IN ('room', 'spectator')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT multi_chat_sender_snapshot_check CHECK (
        (sender_role = 'player' AND sender_seat IS NOT NULL AND channel = 'room')
        OR
        (sender_role = 'spectator' AND sender_seat IS NULL AND channel = 'spectator')
    ),
    UNIQUE (room_id, position),
    UNIQUE (room_id, sender_member_id, client_message_id)
);

CREATE INDEX multi_chat_message_room_position_idx
    ON multi_chat_message (room_id, position);

CREATE INDEX multi_chat_message_created_at_idx
    ON multi_chat_message (created_at);

-- +goose Down
-- Expand-only rollback: the previous binary ignores chat state, while retaining
-- messages keeps a rollback from silently destroying user history.
SELECT 1;
