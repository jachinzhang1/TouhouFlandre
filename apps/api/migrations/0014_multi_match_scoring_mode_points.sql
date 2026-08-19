-- +goose Up

ALTER TABLE multi_match
    DROP CONSTRAINT multi_match_scoring_mode_check;

ALTER TABLE multi_match
    ADD CONSTRAINT multi_match_scoring_mode_check
    CHECK (scoring_mode IN ('wins', 'points', 'placement'));

-- +goose Down
-- Expand-only rollback: keep the widened scoring_mode constraint in place.
SELECT 1;
