ALTER TABLE work
    ADD COLUMN IF NOT EXISTS pinyin_initials jsonb NOT NULL DEFAULT '[]'::jsonb;
