-- +goose Up
-- MPX-002A: separate stable member identity from display seat and add room capacity.

ALTER TABLE multi_room
    ADD COLUMN player_limit integer NOT NULL DEFAULT 2;

ALTER TABLE multi_room
    ADD CONSTRAINT multi_room_player_limit_check CHECK (player_limit BETWEEN 2 AND 8),
    ADD CONSTRAINT multi_room_relay_player_limit_check CHECK (mode <> 'relay' OR player_limit = 2);

DROP INDEX multi_member_room_player_slot_key;

ALTER TABLE multi_member
    DROP CONSTRAINT multi_member_role_slot_check;

ALTER TABLE multi_member
    RENAME COLUMN slot TO seat;

ALTER TABLE multi_member
    ADD CONSTRAINT multi_member_role_seat_check CHECK (
        (role = 'player' AND seat IS NOT NULL AND seat > 0)
        OR
        (role = 'spectator' AND seat IS NULL)
    );

CREATE UNIQUE INDEX multi_member_room_player_seat_key
    ON multi_member (room_id, seat)
    WHERE role = 'player';

-- +goose Down
-- Down is for disposable test databases only. Production rollback keeps the expand schema.

DROP INDEX multi_member_room_player_seat_key;

ALTER TABLE multi_member
    DROP CONSTRAINT multi_member_role_seat_check;

ALTER TABLE multi_member
    RENAME COLUMN seat TO slot;

ALTER TABLE multi_member
    ADD CONSTRAINT multi_member_role_slot_check CHECK (
        (role = 'player' AND slot IS NOT NULL AND slot BETWEEN 1 AND 2)
        OR
        (role = 'spectator' AND slot IS NULL)
    );

CREATE UNIQUE INDEX multi_member_room_player_slot_key
    ON multi_member (room_id, slot)
    WHERE role = 'player';

ALTER TABLE multi_room
    DROP CONSTRAINT multi_room_relay_player_limit_check,
    DROP CONSTRAINT multi_room_player_limit_check,
    DROP COLUMN player_limit;
