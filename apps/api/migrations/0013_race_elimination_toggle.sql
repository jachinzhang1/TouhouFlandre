-- +goose Up

ALTER TABLE multi_room
    ADD COLUMN race_elimination_enabled boolean NOT NULL DEFAULT false;

-- +goose Down

ALTER TABLE multi_room
    DROP COLUMN race_elimination_enabled;
