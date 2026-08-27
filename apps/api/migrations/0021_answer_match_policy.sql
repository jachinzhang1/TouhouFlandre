-- +goose Up

ALTER TABLE game_session
    ADD COLUMN answer_match_policy text NOT NULL DEFAULT 'strict';

ALTER TABLE daily_puzzle
    ADD COLUMN answer_match_policy text NOT NULL DEFAULT 'strict';

ALTER TABLE multi_match
    ADD COLUMN answer_match_policy text NOT NULL DEFAULT 'strict';

ALTER TABLE game_session
    ADD CONSTRAINT game_session_answer_match_policy_check
    CHECK (answer_match_policy IN ('strict', 'public_fields_v1'));

ALTER TABLE daily_puzzle
    ADD CONSTRAINT daily_puzzle_answer_match_policy_check
    CHECK (answer_match_policy IN ('strict', 'public_fields_v1'));

ALTER TABLE multi_match
    ADD CONSTRAINT multi_match_answer_match_policy_check
    CHECK (answer_match_policy IN ('strict', 'public_fields_v1'));

UPDATE multi_match
SET rule_config_snapshot = rule_config_snapshot || jsonb_build_object(
    'answerMatchPolicy', answer_match_policy
);

-- +goose Down

UPDATE multi_match
SET rule_config_snapshot = rule_config_snapshot - 'answerMatchPolicy';

ALTER TABLE multi_match DROP COLUMN answer_match_policy;
ALTER TABLE daily_puzzle DROP COLUMN answer_match_policy;
ALTER TABLE game_session DROP COLUMN answer_match_policy;
