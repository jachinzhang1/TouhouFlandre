use crate::{
    app::AppState,
    contracts,
    error::{ApiError, room_not_found},
    game,
    repository::{models::*, multi as store},
    service::{
        catalog,
        multi::{RoomEffect, auth, conflict, events, invalid, matches, new_id, race, relay},
    },
};
use axum::http::StatusCode;

use chrono::{DateTime, Utc};
use rand::TryRng;
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Mutex, OnceLock},
};

pub fn normalize_name(value: &str) -> String {
    let clean: String = value.trim().chars().filter(|c| !c.is_control()).collect();
    let value: String = clean.trim().chars().take(16).collect();
    if value.is_empty() {
        "匿名玩家".into()
    } else {
        value
    }
}
pub fn normalize_code(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_uppercase)
        .collect()
}
fn room_code() -> String {
    let mut bytes = [0u8; 6];
    rand::rngs::SysRng
        .try_fill_bytes(&mut bytes)
        .expect("operating system random source");
    const A: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    bytes
        .into_iter()
        .map(|b| A[b as usize % A.len()] as char)
        .collect()
}
pub fn participant(member: &Member) -> Value {
    let mut v = json!({"memberId":member.id,"role":if member.is_player(){"player"}else{"spectator"},"displayName":member.display_name,"status":member.status});
    if member.is_player() {
        v["seat"] = json!(member.seat());
    }
    v
}
pub fn ready_reason(room: &Room, players: &[Member]) -> Option<&'static str> {
    if players.len() < 2 {
        return Some("not_enough_players");
    }
    if players.len() > room.player_limit as usize {
        return Some("invalid_player_count");
    }
    if room.mode == "relay" && !players.len().is_multiple_of(2) {
        return Some("odd_player_count");
    }
    for p in players {
        if p.status != "connected" {
            return Some("player_disconnected");
        }
        if !p.ready {
            return Some("player_not_ready");
        }
    }
    if !players.iter().any(|p| p.seat() == 1) {
        return Some("host_missing");
    }
    None
}
pub fn updated_payload(
    room: &Room,
    players: &[Member],
    spectators: i64,
    relay_elimination: bool,
) -> Value {
    let mut v = json!({"format":room.format,"mode":room.mode,"turnSeconds":room.turn_seconds,"playerLimit":room.player_limit,"raceEliminationEnabled":room.race_elimination_enabled,"minPlayers":2,"playerCount":players.len(),"availableSeats":(room.player_limit-players.len() as i32).max(0),"spectatorCount":spectators,"members":players.iter().map(|p|json!({"memberId":p.id,"seat":p.seat(),"displayName":p.display_name,"status":p.status,"ready":p.ready})).collect::<Vec<_>>()});
    if room.mode == "relay" {
        v["relayEliminationEnabled"] = json!(relay_elimination);
        if let Some(reason) = ready_reason(room, players) {
            v["startBlockedReason"] = json!(reason);
        }
    }
    v
}
pub async fn append_updated(
    conn: &mut PgConnection,
    room: &Room,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    let players = store::members(conn, &room.id).await?;
    let spectators = store::spectator_count(conn, &room.id).await?;
    let relay = if room.mode == "relay" {
        store::relay_elimination(conn, &room.id).await?
    } else {
        false
    };
    events::append_event(
        conn,
        &room.id,
        "room.updated",
        updated_payload(room, &players, spectators, relay),
        now,
    )
    .await?;
    Ok(())
}
fn request_body(schema: &str, input: Result<Value, ApiError>) -> Result<Value, ApiError> {
    let value = input?;
    contracts::validate_value(schema, &value).map_err(|_| invalid("请求参数不合法。"))?;
    Ok(value)
}
fn mode_available(state: &AppState, mode: &str) -> Result<(), ApiError> {
    if !["race", "relay"].contains(&mode)
        || (mode == "relay" && state.config.multi.mode_registry == "race-only")
        || (mode == "race" && state.config.multi.mode_registry == "relay-only")
    {
        return Err(invalid("非法多人玩法。"));
    }
    Ok(())
}
fn validate_settings(
    state: &AppState,
    mode: &str,
    limit: i32,
    race: Option<bool>,
    relay: Option<bool>,
) -> Result<(), ApiError> {
    mode_available(state, mode)?;
    if race.is_some() && relay.is_some() {
        return Err(invalid("不能同时提交竞速和接力淘汰设置。"));
    }
    if mode == "race" && relay.is_some() {
        return Err(invalid("竞速房间不能提交接力淘汰设置。"));
    }
    if mode == "relay" && race.is_some() {
        return Err(invalid("接力房间不能提交竞速淘汰设置。"));
    }
    if !(2..=8).contains(&limit) || (mode == "relay" && limit % 2 != 0) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_PLAYER_LIMIT",
            "玩家上限不合法。",
        ));
    }
    if mode == "race" && limit > 2 && !state.config.multi.n_player_race_enabled {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_PLAYER_LIMIT",
            "多人竞速仍在灰度中，当前只能使用双人上限。",
        ));
    }
    if mode == "relay"
        && ((limit > 2 && !state.config.multi.n_player_relay_enabled)
            || (relay == Some(true) && !state.config.multi.relay_elimination_enabled))
    {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FEATURE_DISABLED",
            "多人接力或接力淘汰仍在灰度中。",
        ));
    }
    Ok(())
}
fn joinable(room: &Room, now: DateTime<Utc>) -> Result<(), ApiError> {
    if room.status == "closed"
        || (room.status == "finished" && room.expires_at.is_some_and(|end| now >= end))
    {
        return Err(room_not_found());
    }
    Ok(())
}
fn next_seat(players: &[Member], limit: i32) -> Option<i32> {
    (1..=limit).find(|s| !players.iter().any(|p| p.seat() == *s))
}
pub fn limit_public(state: &AppState, peer: Option<SocketAddr>) -> Result<(), ApiError> {
    type RateWindows = HashMap<String, (DateTime<Utc>, usize)>;
    static WINDOWS: OnceLock<Mutex<RateWindows>> = OnceLock::new();
    let now = (state.clock)();
    let key = peer
        .map(|v| v.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".into());
    let mut windows = WINDOWS.get_or_init(Default::default).lock().unwrap();
    windows
        .retain(|_, (start, _)| now.signed_duration_since(*start) < chrono::Duration::minutes(1));
    let w = windows.entry(key).or_insert((now, 0));
    w.1 += 1;
    if w.1 > state.config.multi.join_rate_limit {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "尝试过于频繁，请稍后再试。",
        ));
    }
    Ok(())
}
pub async fn create(state: AppState, body: Result<Value, ApiError>) -> Result<Value, ApiError> {
    let b = body?;
    let format = b["format"].as_str().unwrap_or("");
    if !["bo1", "bo3", "bo5", "bo7"].contains(&format) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_FORMAT",
            "非法赛制。",
        ));
    }
    let mode = b["mode"].as_str().unwrap_or("race");
    let limit = b["playerLimit"].as_i64().unwrap_or(2) as i32;
    let re = b["raceEliminationEnabled"].as_bool();
    let le = b["relayEliminationEnabled"].as_bool();
    validate_settings(&state, mode, limit, re, le)?;
    contracts::validate_value("RoomsCreateRequestBody", &b)
        .map_err(|_| invalid("请求参数不合法。"))?;
    let turn = b["turnSeconds"].as_i64().unwrap_or_else(|| {
        let n = state.config.multi.turn_seconds.num_seconds();
        if [30, 60, 90, 120].contains(&n) {
            n
        } else {
            60
        }
    }) as i32;
    let display = normalize_name(b["displayName"].as_str().unwrap_or(""));
    let mut conn = state.pool.acquire().await?;
    let (version, characters, works) = catalog::current_catalog(&mut conn).await?;
    let input = b
        .get("questionScope")
        .map(|v| serde_json::from_value::<game::QuestionScopeConfig>(v.clone()))
        .transpose()?;
    let scope = game::normalize_question_scope(
        input.as_ref(),
        &version,
        &catalog::scope_works(&works, &characters),
        &characters,
    )
    .config;
    drop(conn);
    for attempt in 0..5 {
        let id = new_id();
        let token = auth::generate_token()?;
        let code = room_code();
        let now = (state.clock)();
        let mut tx = state.pool.begin().await?;
        let inserted=sqlx::query("INSERT INTO multi_room(id,code,format,mode,turn_seconds,player_limit,race_elimination_enabled,status,expires_at,question_scope,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'lobby',$8,$9,$10)").bind(&id).bind(&code).bind(format).bind(mode).bind(turn).bind(limit).bind(re.unwrap_or(false)).bind(now+state.config.multi.lobby_ttl).bind(json!(scope)).bind(now).execute(&mut *tx).await;
        if let Err(error) = inserted {
            let collision = error.as_database_error().is_some_and(|e| {
                e.code().as_deref() == Some("23505")
                    && e.constraint() == Some("multi_room_code_key")
            });
            if collision && attempt < 4 {
                continue;
            }
            return Err(ApiError::from(error));
        }
        if mode == "relay" {
            sqlx::query(
                "INSERT INTO multi_relay_room_config(room_id,elimination_enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET elimination_enabled=EXCLUDED.elimination_enabled",
            )
            .bind(&id)
            .bind(le.unwrap_or(false))
            .execute(&mut *tx)
            .await
            ?;
        }
        let member:Member=sqlx::query_as("INSERT INTO multi_member(id,room_id,seat,role,display_name,token_hash,joined_at) VALUES($1,$2,1,'player',$3,$4,$5) RETURNING *").bind(new_id()).bind(&id).bind(&display).bind(auth::hash_token(&token)).bind(now).fetch_one(&mut *tx).await?;
        let room = store::room(&mut tx, &id, false).await?;
        append_updated(&mut tx, &room, now).await?;
        tx.commit().await?;
        events::publish(&state, &RoomEffect::game(&id));
        return Ok(
            json!({"roomId":id,"roomCode":code,"guestToken":token,"viewer":participant(&member),"questionScope":scope}),
        );
    }
    Err(ApiError::invariant(
        "room code allocation retries exhausted",
    ))
}
pub async fn info(
    state: AppState,
    code: String,
    peer: Option<SocketAddr>,
) -> Result<Value, ApiError> {
    limit_public(&state, peer)?;
    let mut conn = state.pool.acquire().await?;
    let room = store::room_by_code(&mut conn, &normalize_code(&code), false).await?;
    joinable(&room, (state.clock)())?;
    super::validate_mode(&state, &room.mode)?;
    let players = store::members(&mut conn, &room.id).await?;
    let spectators = store::spectator_count(&mut conn, &room.id).await?;
    let relay = if room.mode == "relay" {
        store::relay_elimination(&mut conn, &room.id).await?
    } else {
        false
    };
    let mut v = updated_payload(&room, &players, spectators, relay);
    v["roomCode"] = json!(room.code);
    v["status"] = json!(room.status);
    v["joinRole"] = json!(
        if room.status == "lobby" && players.len() < (room.player_limit as usize) {
            "player"
        } else {
            "spectator"
        }
    );
    v["questionScope"] = room.question_scope.clone();
    for m in v["members"].as_array_mut().unwrap() {
        m.as_object_mut().unwrap().remove("displayName");
    }
    Ok(v)
}
pub async fn join(
    state: AppState,
    code: String,
    peer: Option<SocketAddr>,
    body: Result<Value, ApiError>,
) -> Result<Value, ApiError> {
    limit_public(&state, peer)?;
    let b = request_body("RoomsJoinRequestBody", body)?;
    let mut tx = state.pool.begin().await?;
    let room = store::room_by_code(&mut tx, &normalize_code(&code), true).await?;
    let now = (state.clock)();
    joinable(&room, now)?;
    super::validate_mode(&state, &room.mode)?;
    let players = store::members(&mut tx, &room.id).await?;
    let role = if room.status == "lobby" && players.len() < room.player_limit as usize {
        "player"
    } else {
        "spectator"
    };
    if role == "spectator" && store::spectator_count(&mut tx, &room.id).await? >= 32 {
        return Err(conflict("ROOM_FULL", "房间已满。"));
    }
    let seat = if role == "player" {
        Some(
            next_seat(&players, room.player_limit)
                .ok_or_else(|| ApiError::invariant("available player seat missing"))?,
        )
    } else {
        None
    };
    let token = auth::generate_token()?;
    let member:Member=sqlx::query_as("INSERT INTO multi_member(id,room_id,seat,role,display_name,token_hash,joined_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *").bind(new_id()).bind(&room.id).bind(seat).bind(role).bind(normalize_name(b["displayName"].as_str().unwrap_or(""))).bind(auth::hash_token(&token)).bind(now).fetch_one(&mut *tx).await?;
    append_updated(&mut tx, &room, now).await?;
    tx.commit().await?;
    events::publish(&state, &RoomEffect::game(&room.id));
    Ok(json!({"roomId":room.id,"guestToken":token,"viewer":participant(&member),"joinRole":role}))
}
pub async fn ready(
    state: AppState,
    id: String,
    authorization: &str,
    body: Result<Value, ApiError>,
) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    auth::require_player(&member)?;
    let b = request_body("RoomsSetReadyRequestBody", body)?;
    let desired = b["ready"]
        .as_bool()
        .ok_or_else(|| invalid("缺少请求体。"))?;
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, true).await?;
    super::validate_mode(&state, &room.mode)?;
    if room.status == "closed" {
        return Err(conflict("ROOM_CLOSED", "房间状态不允许该操作。"));
    }
    if room.status != "lobby" || store::latest_match(&mut tx, &id, false).await?.is_some() {
        return Err(conflict("MATCH_ALREADY_STARTED", "对局已开始。"));
    }
    let players = store::members(&mut tx, &id).await?;
    if players
        .iter()
        .any(|p| p.id == member.id && p.ready == desired)
    {
        tx.commit().await?;
        return Ok(());
    }
    sqlx::query("UPDATE multi_member SET ready=$2 WHERE id=$1")
        .bind(&member.id)
        .bind(desired)
        .execute(&mut *tx)
        .await?;
    let players = store::members(&mut tx, &id).await?;
    if desired && ready_reason(&room, &players).is_none() {
        matches::start_match_tx(&state, &mut tx, &room).await?;
    }
    append_updated(&mut tx, &room, (state.clock)()).await?;
    tx.commit().await?;
    events::publish(&state, &RoomEffect::game(&id));
    Ok(())
}
pub async fn claim(state: AppState, id: String, authorization: &str) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    if member.is_player() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "SPECTATOR_READ_ONLY",
            "观战席只能查看对局。",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, true).await?;
    super::validate_mode(&state, &room.mode)?;
    if room.status != "lobby" {
        return Err(conflict("MATCH_ALREADY_STARTED", "对局已开始。"));
    }
    let current = store::member(&mut tx, &member.id).await?;
    if current.status != "connected" {
        return Err(auth::unauthorized("成员未连接，请先重新连接房间。"));
    }
    if current.is_player() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "SPECTATOR_READ_ONLY",
            "观战席只能查看对局。",
        ));
    }
    let seat = next_seat(&store::members(&mut tx, &id).await?, room.player_limit)
        .ok_or_else(|| conflict("ROOM_FULL", "房间已满。"))?;
    sqlx::query("UPDATE multi_member SET role='player',seat=$2,ready=false,rematch_ready=false WHERE id=$1 AND role='spectator' AND status='connected'").bind(&member.id).bind(seat).execute(&mut *tx).await?;
    append_updated(&mut tx, &room, (state.clock)()).await?;
    tx.commit().await?;
    state.realtime.invalidate_member(&id, &member.id);
    events::publish(&state, &RoomEffect::game(&id));
    Ok(())
}
pub async fn settings(
    state: AppState,
    id: String,
    authorization: &str,
    body: Result<Value, ApiError>,
) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    auth::require_player(&member)?;
    if member.seat() != 1 {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "GUEST_UNAUTHORIZED",
            "只有房主可以修改房间设置。",
        ));
    }
    if member.status != "connected" {
        return Err(auth::unauthorized("成员未连接，请先重新连接房间。"));
    }
    let b = body?;
    if b["playerLimit"]
        .as_i64()
        .is_some_and(|n| !(2..=8).contains(&n))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_PLAYER_LIMIT",
            "玩家上限不合法。",
        ));
    }
    contracts::validate_value("RoomsUpdateSettingsRequestBody", &b)
        .map_err(|_| invalid("请求参数不合法。"))?;
    if [
        "playerLimit",
        "raceEliminationEnabled",
        "relayEliminationEnabled",
    ]
    .iter()
    .all(|key| b.get(key).is_none())
    {
        return Err(invalid("缺少请求体。"));
    }
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, true).await?;
    super::validate_mode(&state, &room.mode)?;
    let limit = b["playerLimit"]
        .as_i64()
        .unwrap_or(room.player_limit as i64) as i32;
    let re = b["raceEliminationEnabled"].as_bool();
    let le = b["relayEliminationEnabled"].as_bool();
    validate_settings(&state, &room.mode, limit, re, le)?;
    if room.status != "lobby" || store::latest_match(&mut tx, &id, false).await?.is_some() {
        return Err(conflict(
            "ROOM_SETTINGS_LOCKED",
            "对局开始后房间设置已锁定。",
        ));
    }
    let players = store::members(&mut tx, &id).await?;
    if players.iter().any(|p| p.ready) {
        return Err(conflict(
            "ROOM_SETTINGS_LOCKED",
            "当前有玩家已准备，请先全部取消准备。",
        ));
    }
    if limit < players.len() as i32 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_PLAYER_LIMIT",
            "玩家上限不能低于当前玩家数。",
        ));
    }
    if limit < room.player_limit {
        if players
            .first()
            .is_none_or(|p| p.id != member.id || p.seat() != 1)
        {
            return Err(ApiError::invariant("room host seat missing"));
        }
        for (index, p) in players.iter().enumerate().skip(1) {
            if p.seat() != index as i32 + 1 {
                sqlx::query("UPDATE multi_member SET seat=$2 WHERE id=$1")
                    .bind(&p.id)
                    .bind(index as i32 + 1)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    let old_relay = if room.mode == "relay" {
        store::relay_elimination(&mut tx, &id).await?
    } else {
        false
    };
    let changed = limit != room.player_limit
        || re.is_some_and(|v| v != room.race_elimination_enabled)
        || le.is_some_and(|v| v != old_relay);
    if changed {
        sqlx::query(
            "UPDATE multi_room SET player_limit=$2,race_elimination_enabled=$3 WHERE id=$1",
        )
        .bind(&id)
        .bind(limit)
        .bind(re.unwrap_or(room.race_elimination_enabled))
        .execute(&mut *tx)
        .await?;
        if let Some(enabled) = le {
            sqlx::query("INSERT INTO multi_relay_room_config(room_id,elimination_enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET elimination_enabled=EXCLUDED.elimination_enabled").bind(&id).bind(enabled).execute(&mut *tx).await?;
        }
        let updated = store::room(&mut tx, &id, false).await?;
        append_updated(&mut tx, &updated, (state.clock)()).await?;
    }
    tx.commit().await?;
    if changed {
        events::publish(&state, &RoomEffect::game(&id));
    }
    Ok(())
}
pub async fn close(state: AppState, id: String, authorization: &str) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    auth::require_player(&member)?;
    if member.seat() != 1 {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "GUEST_UNAUTHORIZED",
            "只有房主可以关闭房间。",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, true).await?;
    super::validate_mode(&state, &room.mode)?;
    if room.status != "lobby" {
        return Err(conflict("ROOM_CLOSED", "房间状态不允许该操作。"));
    }
    close_tx(&state, &mut tx, &room, "host_left", (state.clock)()).await?;
    tx.commit().await?;
    events::publish(&state, &RoomEffect::game(&id));
    Ok(())
}
pub async fn close_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE multi_room SET status='closed',expires_at=$2 WHERE id=$1")
        .bind(&room.id)
        .bind(now + state.config.multi.event_retention)
        .execute(&mut *conn)
        .await?;
    events::append_event(conn, &room.id, "room.closed", json!({"reason":reason}), now).await?;
    Ok(())
}
pub async fn mark_left_tx(
    conn: &mut PgConnection,
    room: &Room,
    member: &Member,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE multi_member SET status='left',grace_until=NULL WHERE id=$1")
        .bind(&member.id)
        .execute(&mut *conn)
        .await?;
    append_updated(conn, room, now).await
}
pub async fn leave(state: AppState, id: String, authorization: &str) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    let mut conn = state.pool.acquire().await?;
    let room = store::room(&mut conn, &id, false).await?;
    drop(conn);
    if room.status == "playing" && member.is_player() {
        let effect = forfeit_member(&state, &room, &member, "forfeit").await?;
        events::publish(&state, &effect);
        return Ok(());
    }
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, true).await?;
    super::validate_mode(&state, &room.mode)?;
    if room.status == "closed" {
        return Err(conflict("ROOM_CLOSED", "房间状态不允许该操作。"));
    }
    if room.status == "playing" && member.is_player() {
        tx.rollback().await?;
        let effect = forfeit_member(&state, &room, &member, "forfeit").await?;
        events::publish(&state, &effect);
        return Ok(());
    }
    let now = (state.clock)();
    if member.is_spectator() || room.status == "finished" {
        mark_left_tx(&mut tx, &room, &member, now).await?;
    } else if member.seat() == 1 {
        close_tx(&state, &mut tx, &room, "host_left", now).await?;
    } else {
        sqlx::query("DELETE FROM multi_member WHERE id=$1")
            .bind(&member.id)
            .execute(&mut *tx)
            .await?;
        append_updated(&mut tx, &room, now).await?;
    }
    tx.commit().await?;
    events::publish(&state, &RoomEffect::game(&id));
    Ok(())
}
pub async fn forfeit_member(
    state: &AppState,
    room: &Room,
    member: &Member,
    reason: &str,
) -> Result<RoomEffect, ApiError> {
    super::validate_mode(state, &room.mode)?;
    let mut tx = state.pool.begin().await?;
    let effect = if room.mode == "relay" {
        relay::forfeit_member_tx(state, &mut tx, room, member, reason, (state.clock)()).await?
    } else {
        race::forfeit_member_tx(state, &mut tx, room, member, reason, (state.clock)()).await?
    };
    tx.commit().await?;
    Ok(effect)
}
