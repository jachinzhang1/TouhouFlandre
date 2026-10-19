UPDATE multi_match
SET rule_config_snapshot = rule_config_snapshot - 'answerMatchPolicy';

ALTER TABLE multi_match DROP COLUMN answer_match_policy;
ALTER TABLE daily_puzzle DROP COLUMN answer_match_policy;
ALTER TABLE game_session DROP COLUMN answer_match_policy;
