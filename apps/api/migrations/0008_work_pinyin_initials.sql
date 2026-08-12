-- +goose Up
ALTER TABLE work
    ADD COLUMN IF NOT EXISTS pinyin_initials jsonb NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE work DROP COLUMN IF EXISTS pinyin_initials;
