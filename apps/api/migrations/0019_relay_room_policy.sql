-- +goose Up
-- MRX-004: relay-owned room capacity/setting state. This migration is
-- expand-only so an older binary can continue creating legacy rooms.

ALTER TABLE multi_room
    DROP CONSTRAINT IF EXISTS multi_room_relay_player_limit_check,
    ADD CONSTRAINT multi_room_relay_player_limit_check
    CHECK (mode <> 'relay' OR player_limit IN (2, 4, 6, 8));

CREATE TABLE IF NOT EXISTS multi_relay_room_config (
    room_id             text PRIMARY KEY REFERENCES multi_room (id) ON DELETE CASCADE,
    elimination_enabled boolean NOT NULL DEFAULT false
);

INSERT INTO multi_relay_room_config (room_id, elimination_enabled)
SELECT id, false
FROM multi_room
WHERE mode = 'relay'
ON CONFLICT (room_id) DO NOTHING;

-- Keep the new config row present when a previous binary inserts a relay room
-- without knowing about this table.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION populate_multi_relay_room_config()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.mode = 'relay' THEN
        INSERT INTO multi_relay_room_config (room_id, elimination_enabled)
        VALUES (NEW.id, false)
        ON CONFLICT (room_id) DO NOTHING;
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS multi_room_relay_config_after_insert ON multi_room;
CREATE TRIGGER multi_room_relay_config_after_insert
AFTER INSERT ON multi_room
FOR EACH ROW
EXECUTE FUNCTION populate_multi_relay_room_config();

-- +goose Down
-- Expand-only rollback: retain relay settings and compatibility trigger.
SELECT 1;
