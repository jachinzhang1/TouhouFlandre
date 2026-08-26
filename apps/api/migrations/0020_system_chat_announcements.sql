-- +goose Up
-- Server-authored system announcements reuse the independent chat stream.
-- Keep the existing table shape so an application rollback can still scan rows.

ALTER TABLE multi_chat_message
    DROP CONSTRAINT multi_chat_sender_snapshot_check;

ALTER TABLE multi_chat_message
    DROP CONSTRAINT multi_chat_message_sender_role_check;

ALTER TABLE multi_chat_message
    ADD CONSTRAINT multi_chat_message_sender_role_check
    CHECK (sender_role IN ('player', 'spectator', 'system'));

ALTER TABLE multi_chat_message
    ADD CONSTRAINT multi_chat_sender_snapshot_check CHECK (
        (sender_role = 'player'
            AND sender_member_id <> 'system'
            AND sender_seat IS NOT NULL
            AND channel = 'room')
        OR
        (sender_role = 'spectator'
            AND sender_member_id <> 'system'
            AND sender_seat IS NULL
            AND channel = 'spectator')
        OR
        (sender_role = 'system'
            AND sender_member_id = 'system'
            AND sender_display_name = '系统'
            AND sender_seat IS NULL
            AND kind = 'text'
            AND channel = 'room')
    );

-- +goose Down
-- Expand-only rollback: system rows must remain readable by the previous binary.
SELECT 1;
