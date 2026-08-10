-- +goose Up

ALTER TABLE game_session
    ADD COLUMN question_scope jsonb;

ALTER TABLE multi_room
    ADD COLUMN question_scope jsonb NOT NULL DEFAULT '{
        "schemaVersion": 2,
        "catalogVersion": "",
        "mode": "preset",
        "difficulty": "hard",
        "selectedCharacterIds": [],
        "workStates": [],
        "rules": {
            "fields": {
                "firstAppearance": true,
                "releaseYear": "directional",
                "species": true,
                "affiliations": true,
                "locations": true,
                "hairColors": true
            },
            "turnLimit": { "enabled": false, "seconds": 30 }
        }
    }'::jsonb;

ALTER TABLE multi_match
    ADD COLUMN question_scope jsonb;

ALTER TABLE daily_puzzle
    ADD COLUMN difficulty text NOT NULL DEFAULT 'normal';

ALTER TABLE daily_puzzle
    DROP CONSTRAINT daily_puzzle_pkey,
    ADD PRIMARY KEY (date_key, difficulty);

CREATE INDEX daily_puzzle_date_key_idx ON daily_puzzle (date_key);
CREATE INDEX daily_puzzle_difficulty_idx ON daily_puzzle (difficulty);

-- +goose Down

DROP INDEX daily_puzzle_difficulty_idx;
DROP INDEX daily_puzzle_date_key_idx;

ALTER TABLE daily_puzzle
    DROP CONSTRAINT daily_puzzle_pkey,
    ADD PRIMARY KEY (date_key);

ALTER TABLE daily_puzzle
    DROP COLUMN difficulty;

ALTER TABLE multi_match
    DROP COLUMN question_scope;

ALTER TABLE multi_room
    DROP COLUMN question_scope;

ALTER TABLE game_session
    DROP COLUMN question_scope;
