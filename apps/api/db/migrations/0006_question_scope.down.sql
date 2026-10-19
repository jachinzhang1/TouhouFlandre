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
