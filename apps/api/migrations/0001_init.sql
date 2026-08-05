-- +goose Up
CREATE TABLE work (
    id            text PRIMARY KEY,
    title_zh      text NOT NULL,
    title_ja      text NOT NULL,
    title_en      text,
    short_name    text NOT NULL,
    type          text NOT NULL,
    release_year  integer NOT NULL,
    mainline_index integer,
    era           text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE character (
    id                    text PRIMARY KEY,
    avatar_url            text NOT NULL,
    display_name          text NOT NULL,
    name_sort_key         text NOT NULL,
    search_text           text NOT NULL,
    appearance_order      integer NOT NULL,
    first_appearance_work_id text NOT NULL REFERENCES work (id) ON DELETE RESTRICT,
    names                 jsonb NOT NULL,
    first_appearance      jsonb NOT NULL,
    species               jsonb NOT NULL,
    ability_display       text NOT NULL,
    ability_tags          jsonb NOT NULL,
    affiliations          jsonb NOT NULL,
    locations             jsonb NOT NULL,
    roles                 jsonb NOT NULL,
    hair_colors           jsonb NOT NULL,
    playable              boolean NOT NULL,
    enabled_as_answer     boolean NOT NULL,
    enabled_as_guess      boolean NOT NULL,
    difficulty_tier       text NOT NULL,
    source_refs           jsonb NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX character_guess_name_idx ON character (enabled_as_guess, name_sort_key);
CREATE INDEX character_guess_appearance_idx ON character (enabled_as_guess, appearance_order);
CREATE INDEX character_first_appearance_idx ON character (first_appearance_work_id);

CREATE TABLE catalog_snapshot (
    version        text PRIMARY KEY,
    characters     jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_state (
    id              text PRIMARY KEY DEFAULT 'current',
    current_version text NOT NULL UNIQUE REFERENCES catalog_snapshot (version) ON DELETE RESTRICT,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_puzzle (
    date_key        text PRIMARY KEY,
    catalog_version text NOT NULL REFERENCES catalog_snapshot (version) ON DELETE RESTRICT,
    answer_id       text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX daily_puzzle_catalog_version_idx ON daily_puzzle (catalog_version);

CREATE TABLE game_session (
    id              text PRIMARY KEY,
    mode            text NOT NULL,
    content_type    text NOT NULL DEFAULT 'character',
    answer_id       text NOT NULL,
    catalog_version text NOT NULL REFERENCES catalog_snapshot (version) ON DELETE RESTRICT,
    puzzle_key      text,
    status          text NOT NULL,
    max_guesses     integer NOT NULL,
    guesses         jsonb NOT NULL DEFAULT '[]',
    version         integer NOT NULL DEFAULT 0,
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX game_session_mode_idx ON game_session (mode);
CREATE INDEX game_session_status_idx ON game_session (status);
CREATE INDEX game_session_catalog_version_idx ON game_session (catalog_version);

-- +goose Down
DROP TABLE game_session;
DROP TABLE daily_puzzle;
DROP TABLE catalog_state;
DROP TABLE catalog_snapshot;
DROP TABLE character;
DROP TABLE work;
