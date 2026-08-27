-- +goose Up
-- MRX-003: persist immutable rule-set references and the relay-owned
-- stage/encounter model. The migration is expand-only: legacy race/relay
-- columns remain readable by the compatibility adapters.

ALTER TABLE multi_match
    ADD COLUMN IF NOT EXISTS rule_set_key text,
    ADD COLUMN IF NOT EXISTS rule_set_version integer,
    ADD COLUMN IF NOT EXISTS rule_config_snapshot jsonb;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM multi_match AS match
        JOIN multi_room AS room ON room.id = match.room_id
        WHERE room.mode NOT IN ('race', 'relay')
           OR (room.mode = 'race' AND match.scoring_mode NOT IN ('wins', 'points', 'placement'))
           OR (room.mode = 'relay' AND match.scoring_mode <> 'wins')
    ) THEN
        RAISE EXCEPTION
            'MRX-003 rule-set backfill refused: unknown or contradictory mode/scoring_mode data';
    END IF;
END
$$;
-- +goose StatementEnd

UPDATE multi_match AS match
SET rule_set_key = CASE room.mode
        WHEN 'race' THEN match.scoring_mode
        WHEN 'relay' THEN 'legacy_wins'
    END,
    rule_set_version = 1,
    rule_config_snapshot = jsonb_build_object(
        'mode', room.mode,
        'format', room.format,
        'turnSeconds', room.turn_seconds,
        'rosterSize', match.roster_size,
        'targetWins', match.target_wins,
        'maxRounds', match.max_rounds,
        'questionScope', match.question_scope,
        'raceEliminationEnabled', room.race_elimination_enabled
    )
FROM multi_room AS room
WHERE room.id = match.room_id
  AND (match.rule_set_key IS NULL
    OR match.rule_set_version IS NULL
    OR match.rule_config_snapshot IS NULL);

ALTER TABLE multi_match
    ALTER COLUMN rule_set_key SET NOT NULL,
    ALTER COLUMN rule_set_version SET NOT NULL,
    ALTER COLUMN rule_config_snapshot SET NOT NULL;

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'multi_match_rule_set_version_check'
    ) THEN
        ALTER TABLE multi_match
            ADD CONSTRAINT multi_match_rule_set_version_check
            CHECK (rule_set_version > 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'multi_match_rule_config_snapshot_check'
    ) THEN
        ALTER TABLE multi_match
            ADD CONSTRAINT multi_match_rule_config_snapshot_check
            CHECK (jsonb_typeof(rule_config_snapshot) = 'object');
    END IF;
END
$$;
-- +goose StatementEnd

CREATE INDEX IF NOT EXISTS multi_match_rule_set_idx
    ON multi_match (room_id, rule_set_key, rule_set_version);

-- Keep the expand migration writable by the previous binary. Its INSERT does
-- not name the new columns, so derive the same deterministic legacy mapping.
-- New binaries always provide all three frozen rule-set fields explicitly.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION populate_multi_match_rule_set_for_legacy_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    room_mode text;
    room_format text;
    room_turn_seconds integer;
    room_race_elimination_enabled boolean;
BEGIN
    IF NEW.rule_set_key IS NOT NULL
       AND NEW.rule_set_version IS NOT NULL
       AND NEW.rule_config_snapshot IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.rule_set_key IS NOT NULL
       OR NEW.rule_set_version IS NOT NULL
       OR NEW.rule_config_snapshot IS NOT NULL THEN
        RAISE EXCEPTION
            'MRX-003 rule-set insert refused: partial rule-set data';
    END IF;

    SELECT mode, format, turn_seconds, race_elimination_enabled
    INTO room_mode, room_format, room_turn_seconds, room_race_elimination_enabled
    FROM multi_room
    WHERE id = NEW.room_id;

    IF room_mode = 'race'
       AND NEW.scoring_mode IN ('wins', 'points', 'placement') THEN
        NEW.rule_set_key := NEW.scoring_mode;
    ELSIF room_mode = 'relay' AND NEW.scoring_mode = 'wins' THEN
        NEW.rule_set_key := 'legacy_wins';
    ELSE
        RAISE EXCEPTION
            'MRX-003 legacy rule-set insert refused: unknown or contradictory mode/scoring_mode data';
    END IF;

    NEW.rule_set_version := 1;
    NEW.rule_config_snapshot := jsonb_build_object(
        'mode', room_mode,
        'format', room_format,
        'turnSeconds', room_turn_seconds,
        'rosterSize', NEW.roster_size,
        'targetWins', NEW.target_wins,
        'maxRounds', NEW.max_rounds,
        'questionScope', NEW.question_scope,
        'raceEliminationEnabled', room_race_elimination_enabled
    );
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'multi_match_legacy_rule_set_insert_trigger'
          AND tgrelid = 'multi_match'::regclass
    ) THEN
        CREATE TRIGGER multi_match_legacy_rule_set_insert_trigger
        BEFORE INSERT ON multi_match
        FOR EACH ROW
        EXECUTE FUNCTION populate_multi_match_rule_set_for_legacy_insert();
    END IF;
END
$$;
-- +goose StatementEnd

CREATE TABLE IF NOT EXISTS multi_relay_stage (
    id                         text PRIMARY KEY,
    match_id                   text NOT NULL REFERENCES multi_match (id) ON DELETE CASCADE,
    stage_index                integer NOT NULL CHECK (stage_index > 0),
    status                     text NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'playing', 'settling', 'ended')),
    planned_encounter_count   integer NOT NULL CHECK (planned_encounter_count BETWEEN 1 AND 4),
    starts_at                  timestamptz NOT NULL,
    settled_at                 timestamptz,
    settlement_marker          text UNIQUE,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (match_id, stage_index),
    UNIQUE (id, match_id)
);

CREATE INDEX IF NOT EXISTS multi_relay_stage_match_status_idx
    ON multi_relay_stage (match_id, status, stage_index);

CREATE TABLE IF NOT EXISTS multi_relay_encounter (
    id              text PRIMARY KEY,
    match_id        text NOT NULL,
    stage_id        text NOT NULL,
    encounter_index integer NOT NULL CHECK (encounter_index BETWEEN 1 AND 4),
    status          text NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'countdown', 'playing', 'ended')),
    answer_id       text NOT NULL,
    starts_at       timestamptz NOT NULL,
    deadline        timestamptz NOT NULL,
    turn_member_id  text,
    turn_deadline   timestamptz,
    winner_member_id text,
    outcome         text CHECK (outcome IN ('win', 'loss', 'draw', 'forfeit', 'timeout')),
    ended_at        timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT multi_relay_encounter_stage_fk
        FOREIGN KEY (stage_id, match_id)
        REFERENCES multi_relay_stage (id, match_id) ON DELETE CASCADE,
    UNIQUE (stage_id, encounter_index),
    UNIQUE (id, stage_id, match_id),
    CONSTRAINT multi_relay_encounter_ended_consistency CHECK (
        (status = 'ended') = (ended_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS multi_relay_encounter_stage_status_idx
    ON multi_relay_encounter (stage_id, status, encounter_index);

CREATE TABLE IF NOT EXISTS multi_relay_encounter_member (
    match_id     text NOT NULL,
    stage_id     text NOT NULL,
    encounter_id text NOT NULL,
    member_id    text NOT NULL,
    side         integer NOT NULL CHECK (side IN (1, 2)),
    seat         integer NOT NULL CHECK (seat BETWEEN 1 AND 8),
    PRIMARY KEY (encounter_id, member_id),
    UNIQUE (encounter_id, side),
    UNIQUE (stage_id, member_id),
    UNIQUE (encounter_id, side, member_id),
    CONSTRAINT multi_relay_encounter_member_encounter_fk
        FOREIGN KEY (encounter_id, stage_id, match_id)
        REFERENCES multi_relay_encounter (id, stage_id, match_id) ON DELETE CASCADE,
    CONSTRAINT multi_relay_encounter_member_roster_fk
        FOREIGN KEY (match_id, member_id)
        REFERENCES multi_match_player (match_id, member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS multi_relay_encounter_member_stage_idx
    ON multi_relay_encounter_member (stage_id, side, seat);

CREATE TABLE IF NOT EXISTS multi_relay_turn (
    id               text PRIMARY KEY,
    match_id         text NOT NULL,
    stage_id         text NOT NULL,
    encounter_id     text NOT NULL,
    member_id        text NOT NULL,
    turn_index       integer NOT NULL CHECK (turn_index > 0),
    kind             text NOT NULL CHECK (kind IN ('guess', 'timeout', 'pass')),
    guess_id         text,
    statuses         jsonb,
    is_correct       boolean NOT NULL DEFAULT false,
    idempotency_key  text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT multi_relay_turn_encounter_fk
        FOREIGN KEY (encounter_id, stage_id, match_id)
        REFERENCES multi_relay_encounter (id, stage_id, match_id) ON DELETE CASCADE,
    CONSTRAINT multi_relay_turn_member_fk
        FOREIGN KEY (encounter_id, member_id)
        REFERENCES multi_relay_encounter_member (encounter_id, member_id) ON DELETE CASCADE,
    UNIQUE (encounter_id, turn_index),
    UNIQUE (encounter_id, member_id, idempotency_key),
    UNIQUE (encounter_id, guess_id),
    CHECK (
        (kind = 'guess' AND guess_id IS NOT NULL AND statuses IS NOT NULL AND is_correct IN (true, false))
        OR
        (kind IN ('timeout', 'pass') AND guess_id IS NULL AND statuses IS NULL AND is_correct = false)
    ),
    CHECK (
        statuses IS NULL
        OR (jsonb_typeof(statuses) = 'array' AND jsonb_array_length(statuses) = 6)
    )
);

CREATE INDEX IF NOT EXISTS multi_relay_turn_encounter_idx
    ON multi_relay_turn (encounter_id, turn_index);

CREATE TABLE IF NOT EXISTS multi_relay_match_player_state (
    match_id         text NOT NULL,
    member_id        text NOT NULL,
    score            integer NOT NULL,
    life_state       text NOT NULL DEFAULT 'healthy'
        CHECK (life_state IN ('healthy', 'near_death')),
    eliminated_stage integer CHECK (eliminated_stage >= 1),
    PRIMARY KEY (match_id, member_id),
    CONSTRAINT multi_relay_match_player_state_player_fk
        FOREIGN KEY (match_id, member_id)
        REFERENCES multi_match_player (match_id, member_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS multi_relay_stage_player (
    match_id         text NOT NULL,
    stage_id         text NOT NULL,
    member_id        text NOT NULL,
    encounter_id     text,
    assignment       text NOT NULL CHECK (assignment IN ('paired', 'bye')),
    outcome          text NOT NULL CHECK (outcome IN ('win', 'loss', 'draw', 'bye')),
    score_before     integer NOT NULL,
    score_delta      integer NOT NULL,
    score_after      integer NOT NULL,
    life_before      text NOT NULL CHECK (life_before IN ('healthy', 'near_death')),
    life_after       text NOT NULL CHECK (life_after IN ('healthy', 'near_death')),
    eliminated_stage integer CHECK (eliminated_stage >= 1),
    settled_at       timestamptz,
    PRIMARY KEY (stage_id, member_id),
    CONSTRAINT multi_relay_stage_player_stage_fk
        FOREIGN KEY (stage_id, match_id)
        REFERENCES multi_relay_stage (id, match_id) ON DELETE CASCADE,
    CONSTRAINT multi_relay_stage_player_roster_fk
        FOREIGN KEY (match_id, member_id)
        REFERENCES multi_match_player (match_id, member_id) ON DELETE CASCADE,
    CONSTRAINT multi_relay_stage_player_encounter_fk
        FOREIGN KEY (encounter_id, stage_id, match_id)
        REFERENCES multi_relay_encounter (id, stage_id, match_id) ON DELETE CASCADE,
    CHECK (
        (assignment = 'bye' AND encounter_id IS NULL AND outcome = 'bye')
        OR
        (assignment = 'paired' AND encounter_id IS NOT NULL AND outcome IN ('win', 'loss', 'draw'))
    )
);

CREATE INDEX IF NOT EXISTS multi_relay_stage_player_standings_idx
    ON multi_relay_stage_player (match_id, stage_id, score_after DESC, member_id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enforce_multi_relay_encounter_member_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_encounter_id text;
    target_encounter_ids text[];
    member_count integer;
BEGIN
    IF TG_TABLE_NAME = 'multi_relay_encounter' THEN
        target_encounter_ids := ARRAY[NEW.id];
    ELSIF TG_OP = 'DELETE' THEN
        target_encounter_ids := ARRAY[OLD.encounter_id];
    ELSIF TG_OP = 'UPDATE' THEN
        target_encounter_ids := ARRAY[OLD.encounter_id, NEW.encounter_id];
    ELSE
        target_encounter_ids := ARRAY[NEW.encounter_id];
    END IF;
    FOREACH target_encounter_id IN ARRAY target_encounter_ids LOOP
        IF EXISTS (SELECT 1 FROM multi_relay_encounter WHERE id = target_encounter_id) THEN
            SELECT count(*) INTO member_count
            FROM multi_relay_encounter_member
            WHERE multi_relay_encounter_member.encounter_id = target_encounter_id;
            IF member_count <> 2 THEN
                RAISE EXCEPTION 'relay encounter % must have exactly two members', target_encounter_id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'multi_relay_encounter_count_trigger'
    ) THEN
        CREATE CONSTRAINT TRIGGER multi_relay_encounter_count_trigger
        AFTER INSERT OR UPDATE ON multi_relay_encounter
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION enforce_multi_relay_encounter_member_count();
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'multi_relay_encounter_member_count_trigger'
    ) THEN
        CREATE CONSTRAINT TRIGGER multi_relay_encounter_member_count_trigger
        AFTER INSERT OR UPDATE OR DELETE ON multi_relay_encounter_member
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION enforce_multi_relay_encounter_member_count();
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- Expand-only rollback: production keeps the new tables and columns so the
-- previous binary can continue reading legacy race/relay storage. Disposable
-- migration tests may move the goose version back and reapply this migration.
SELECT 1;
