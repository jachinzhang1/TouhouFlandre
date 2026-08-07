-- +goose Up
-- 多人模式数据模型（docs/08_multiplayer_mode_design.md §9.1）
-- 表结构、索引与 CHECK 约束对齐 08 §9.1 逐字。

CREATE TABLE multi_room (
    id              text PRIMARY KEY,                -- 25 位小写字母数字（同 newSessionID 模式）
    code            text NOT NULL UNIQUE,            -- 6 位房间号
    format          text NOT NULL,                   -- bo1|bo3|bo5|bo7（创建时固定）
    status          text NOT NULL,                   -- lobby|playing|finished|closed（生命周期，见 §6.1）
    event_seq       bigint NOT NULL DEFAULT 0,       -- 事件序号分配器（事务内 UPDATE 取号，见 §9.2）
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL             -- lobby TTL / finished 展示期 / closed 事件保留期
);
CREATE INDEX multi_room_status_idx ON multi_room (status);
CREATE INDEX multi_room_status_expires_idx ON multi_room (status, expires_at);  -- sweeper：lobby/finished/closed 过期

CREATE TABLE multi_match (
    id              text PRIMARY KEY,
    room_id         text NOT NULL REFERENCES multi_room (id) ON DELETE CASCADE,
    match_index     integer NOT NULL,                -- 0=首场，1=第一次再来一局……
    catalog_version text NOT NULL REFERENCES catalog_snapshot (version) ON DELETE RESTRICT,  -- 场级题库绑定（07 §2 快照不变量）
    target_wins     integer NOT NULL,                -- 冗余自 room.format，场级自包含
    score_slot1     integer NOT NULL DEFAULT 0,
    score_slot2     integer NOT NULL DEFAULT 0,
    round_count     integer NOT NULL DEFAULT 0,      -- 本场已开总局数（安全上限判定）
    status          text NOT NULL,                   -- playing|finished
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz,
    UNIQUE (room_id, match_index)
);
CREATE INDEX multi_match_room_idx ON multi_match (room_id, match_index);

CREATE TABLE multi_member (
    id            text PRIMARY KEY,                  -- 成员 id（房间内即游客身份；slot 1 = 房主，§7.1 DELETE 权限判定）
    room_id       text NOT NULL REFERENCES multi_room (id) ON DELETE CASCADE,
    slot          integer NOT NULL CHECK (slot IN (1, 2)),
    display_name  text NOT NULL,
    token_hash    text NOT NULL,                     -- sha256(guestToken)，不存明文
    status        text NOT NULL DEFAULT 'connected', -- connected|disconnected|left
    ready         boolean NOT NULL DEFAULT false,    -- 大厅就绪（仅 lobby 态使用；加入者离开删行，房主 ready 保留）
    rematch_ready boolean NOT NULL DEFAULT false,    -- 再来一局确认（对局结束态使用，开新对局时重置）
    grace_until   timestamptz,                       -- disconnected 时的宽限截止（sweeper 判定超期；connected 为 NULL）
    joined_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (room_id, slot),
    UNIQUE (room_id, token_hash)
);
CREATE INDEX multi_member_token_hash_idx ON multi_member (token_hash);  -- 鉴权查询（WHERE token_hash=$1，不带 room_id）

CREATE TABLE multi_round (
    id              text PRIMARY KEY,
    match_id        text NOT NULL REFERENCES multi_match (id) ON DELETE CASCADE,
    round_index     integer NOT NULL,                 -- 局内序号（1 起）
    answer_id       text NOT NULL,
    status          text NOT NULL,                    -- countdown|playing|ended
    winner_slot     integer CHECK (winner_slot IN (1, 2)),  -- NULL=平局/未决
    starts_at       timestamptz NOT NULL,
    deadline        timestamptz NOT NULL,
    ended_at        timestamptz,
    CONSTRAINT multi_round_ended_consistency CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
    UNIQUE (match_id, round_index)
);
CREATE INDEX multi_round_match_idx ON multi_round (match_id, status);
CREATE INDEX multi_round_status_deadline_idx ON multi_round (status, deadline);  -- sweeper：局超时

CREATE TABLE multi_guess (
    id               text PRIMARY KEY,
    round_id         text NOT NULL REFERENCES multi_round (id) ON DELETE CASCADE,
    member_id        text NOT NULL REFERENCES multi_member (id) ON DELETE CASCADE,
    sequence         integer NOT NULL,               -- 局内该成员猜测序号（1 起）
    guess_id         text NOT NULL,                  -- 角色 id（角色数据按所属场 multi_match.catalog_version 快照恢复）
    statuses         jsonb NOT NULL CHECK (jsonb_typeof(statuses) = 'array' AND jsonb_array_length(statuses) = 6),  -- [6] FeedbackStatus，真实字段序（匿名投影的权威源）
    is_correct       boolean NOT NULL,
    idempotency_key  text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (round_id, member_id, guess_id),
    UNIQUE (round_id, member_id, sequence),
    UNIQUE (round_id, member_id, idempotency_key)
);
CREATE INDEX multi_guess_round_idx ON multi_guess (round_id, sequence);

CREATE TABLE room_event (
    id          bigserial PRIMARY KEY,
    room_id     text NOT NULL REFERENCES multi_room (id) ON DELETE CASCADE,
    sequence    bigint NOT NULL,
    type        text NOT NULL,
    payload     jsonb NOT NULL,                      -- 规范形态（round.guess 存真实列序，不含名称/标签）
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (room_id, sequence)
);
CREATE INDEX room_event_room_seq_idx ON room_event (room_id, sequence);

-- +goose Down
DROP TABLE room_event;
DROP TABLE multi_guess;
DROP TABLE multi_round;
DROP TABLE multi_member;
DROP TABLE multi_match;
DROP TABLE multi_room;
