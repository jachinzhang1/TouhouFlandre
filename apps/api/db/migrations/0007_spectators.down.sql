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
