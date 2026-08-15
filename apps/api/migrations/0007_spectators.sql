-- +goose Up
-- Add spectator participants without changing the two-player game rules.

ALTER TABLE multi_member
    ADD COLUMN role text NOT NULL DEFAULT 'player';

ALTER TABLE multi_member
    DROP CONSTRAINT multi_member_slot_check,
    DROP CONSTRAINT multi_member_room_id_slot_key,
    ALTER COLUMN slot DROP NOT NULL;

ALTER TABLE multi_member
    ADD CONSTRAINT multi_member_role_check CHECK (role IN ('player', 'spectator')),
    ADD CONSTRAINT multi_member_role_slot_check CHECK (
        (role = 'player' AND slot IS NOT NULL AND slot BETWEEN 1 AND 2)
        OR
        (role = 'spectator' AND slot IS NULL)
    );

CREATE UNIQUE INDEX multi_member_room_player_slot_key
    ON multi_member (room_id, slot)
    WHERE role = 'player';

CREATE INDEX multi_member_room_role_status_idx
    ON multi_member (room_id, role, status);

-- +goose Down
DROP INDEX multi_member_room_role_status_idx;
DROP INDEX multi_member_room_player_slot_key;

ALTER TABLE multi_member
    DROP CONSTRAINT multi_member_role_slot_check,
    DROP CONSTRAINT multi_member_role_check;

DELETE FROM multi_member WHERE role = 'spectator';

ALTER TABLE multi_member
    ALTER COLUMN slot SET NOT NULL,
    ADD CONSTRAINT multi_member_slot_check CHECK (slot IN (1, 2)),
    ADD CONSTRAINT multi_member_room_id_slot_key UNIQUE (room_id, slot);

ALTER TABLE multi_member
    DROP COLUMN role;
