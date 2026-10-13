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
