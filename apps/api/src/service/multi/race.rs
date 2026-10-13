use crate::{
    app::AppState,
    error::ApiError,
    repository::{models::*, multi as store},
    service::multi::{RoomEffect, events, matches, projection, rooms},
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;
pub fn elimination_candidates(players: &[MatchPlayer], roster: i32, round: i32) -> Vec<String> {
    if roster <= 2 || round < roster / 2 {
        return vec![];
    }
    let active: Vec<_> = players.iter().filter(|p| p.status == "active").collect();
    if active.len() <= 1 {
        return vec![];
    }
    let score = active.iter().map(|p| p.score).min().unwrap();
    let best = active
        .iter()
        .filter(|p| p.score == score)
        .map(|p| p.best_round_score)
        .min()
        .unwrap();
    let ids: Vec<_> = active
        .iter()
        .filter(|p| p.score == score && p.best_round_score == best)
        .map(|p| p.member_id.clone())
        .collect();
    if ids.len() == active.len() {
        vec![]
    } else {
        ids
    }
}
/// Preserve the legacy score traversal, including its early tie decision.
pub fn unique_top(players: &[MatchPlayer]) -> Option<String> {
    let mut top = players.first()?.score;
    let mut winner = None;
    for p in players {
        if p.score > top {
            top = p.score;
            winner = Some(p.member_id.clone());
        } else if p.score == top {
            if winner.is_none() {
                winner = Some(p.member_id.clone());
            } else {
                return None;
            }
        }
    }
    winner
}
pub fn ranking(players: &[MatchPlayer]) -> Value {
    let mut sorted: Vec<_> = players.iter().collect();
    sorted.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(a.seat.cmp(&b.seat))
            .then(a.member_id.cmp(&b.member_id))
    });
    let mut rank = 0;
    json!(sorted.iter().enumerate().map(|(i,p)|{if i==0||p.score!=sorted[i-1].score{rank=i+1;}let mut value=json!({"memberId":p.member_id,"seat":p.seat,"rank":rank,"score":p.score,"status":p.status});if let Some(round)=p.eliminated_round{value["eliminatedRound"]=json!(round);}value}).collect::<Vec<_>>())
}
pub fn match_result(
    m: &Match,
    players: &[MatchPlayer],
    round_winner: Option<&str>,
    cap: i32,
) -> Option<(&'static str, Option<String>)> {
    if m.scoring_mode == "wins" {
        if let Some(id) = round_winner
            && players
                .iter()
                .any(|p| p.member_id == id && p.score >= m.target_wins)
        {
            return Some(("normal", Some(id.into())));
        }
        if m.round_count >= cap {
            return Some(("round_cap", None));
        }
        return None;
    }
    let active: Vec<_> = players.iter().filter(|p| p.status == "active").collect();
    if active.len() <= 1
        || (m.scoring_mode == "placement"
            && active.len() == 2
            && (active[0].score - active[1].score).abs() > 1)
    {
        return Some(("normal", unique_top(players)));
    }
    if cap > 0 && m.round_count >= cap {
        return Some(("round_cap", unique_top(players)));
    }
    None
}
fn cap(state: &AppState, room: &Room, m: &Match) -> i32 {
    if m.max_rounds > 0 {
        m.max_rounds
    } else {
        matches::max_rounds(
            &m.scoring_mode,
            m.roster_size as usize,
            &room.format,
            state.config.multi.max_rounds_factor,
        )
    }
}
pub(super) async fn current_round(
    conn: &mut PgConnection,
    room: &str,
) -> Result<Option<Round>, ApiError> {
    Ok(sqlx::query_as("SELECT r.* FROM multi_round r JOIN multi_match m ON m.id=r.match_id WHERE m.room_id=$1 AND m.status='playing' ORDER BY r.round_index DESC LIMIT 1 FOR UPDATE OF r").bind(room).fetch_optional(conn).await?)
}
// Keep the locked transaction context and frozen room/match/round explicit.
#[allow(clippy::too_many_arguments)]
pub async fn complete_round_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    round: &Round,
    m: &Match,
    requested_winner: Option<&str>,
    forfeited: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    if round.status == "ended" {
        return Ok(());
    }
    let scored = m.scoring_mode != "wins";
    let mut winner = requested_winner.map(str::to_owned);
    let mut placements = vec![];
    let mut eliminated = vec![];
    if scored {
        sqlx::query("UPDATE multi_round_player SET status='timed_out',completed_at=$2 WHERE round_id=$1 AND status='active'").bind(&round.id).bind(now).execute(&mut *conn).await?;
        let mut participants = store::round_players(conn, &round.id).await?;
        participants.sort_by(|a, b| {
            a.finish_rank
                .unwrap_or(i32::MAX)
                .cmp(&b.finish_rank.unwrap_or(i32::MAX))
                .then(a.member_id.cmp(&b.member_id))
        });
        let total = participants.len() as i32;
        let roster = store::match_players(conn, &m.id).await?;
        let mut rank = 0;
        winner = None;
        for p in participants {
            let points = if p.status == "correct" {
                rank += 1;
                if winner.is_none() {
                    winner = Some(p.member_id.clone());
                }
                total - rank + 1
            } else {
                0
            };
            sqlx::query("UPDATE multi_round_player SET points_awarded=$3 WHERE round_id=$1 AND member_id=$2").bind(&round.id).bind(&p.member_id).bind(points).execute(&mut *conn).await?;
            if points > 0 {
                sqlx::query("UPDATE multi_match_player SET score=score+$3,wins=wins+$3,best_round_score=GREATEST(best_round_score,$3) WHERE match_id=$1 AND member_id=$2 AND status='active'").bind(&m.id).bind(&p.member_id).bind(points).execute(&mut *conn).await?;
            }
            let mut view = json!({"memberId":p.member_id,"seat":roster.iter().find(|r|r.member_id==p.member_id).map(|r|r.seat).unwrap_or(0),"status":p.status,"pointsAwarded":points});
            if let Some(rank) = p.finish_rank {
                view["finishRank"] = json!(rank);
            }
            placements.push(view);
        }
        let players = store::match_players(conn, &m.id).await?;
        if m.scoring_mode == "placement" {
            eliminated = elimination_candidates(&players, m.roster_size, round.round_index);
            for member in &eliminated {
                sqlx::query("UPDATE multi_match_player SET status='eliminated',eliminated_round=$3 WHERE match_id=$1 AND member_id=$2 AND status='active'").bind(&m.id).bind(member).bind(round.round_index).execute(&mut *conn).await?;
            }
        }
    } else if let Some(id) = winner.as_ref() {
        sqlx::query("UPDATE multi_match_player SET wins=wins+1,score=score+1,best_round_score=GREATEST(best_round_score,1) WHERE match_id=$1 AND member_id=$2 AND status='active'").bind(&m.id).bind(id).execute(&mut *conn).await?;
    }
    sqlx::query("UPDATE multi_round SET status='ended',ended_at=$3,winner_member_id=$2,winner_slot=(SELECT seat FROM multi_match_player WHERE match_id=$4 AND member_id=$2) WHERE id=$1").bind(&round.id).bind(&winner).bind(now).bind(&m.id).execute(&mut *conn).await?;
    let players = store::match_players(conn, &m.id).await?;
    let score1 = players
        .iter()
        .find(|p| p.seat == 1)
        .map(|p| p.score)
        .unwrap_or(0);
    let score2 = players
        .iter()
        .find(|p| p.seat == 2)
        .map(|p| p.score)
        .unwrap_or(0);
    sqlx::query("UPDATE multi_match SET score_slot1=$2,score_slot2=$3 WHERE id=$1")
        .bind(&m.id)
        .bind(score1)
        .bind(score2)
        .execute(&mut *conn)
        .await?;
    let mut payload = json!({"roundId":round.id,"matchIndex":m.match_index,"roundIndex":round.round_index,"answerId":round.answer_id,"memberScores":projection::scores(&players),"scores":{"slot1":0,"slot2":0},"nextStartsAt":now+state.config.multi.intermission});
    if let Some(id) = &winner {
        payload["winnerMemberId"] = json!(id);
    }
    if !scored && let Some(id) = forfeited {
        payload["forfeitedMemberId"] = json!(id);
    }
    if !placements.is_empty() {
        payload["placements"] = json!(placements);
    }
    if !eliminated.is_empty() {
        payload["eliminatedMemberIds"] = json!(eliminated);
    }
    events::append_event(conn, &room.id, "round.ended", payload, now).await?;
    if let Some((reason, winner)) =
        match_result(m, &players, winner.as_deref(), cap(state, room, m))
    {
        end_match_tx(state, conn, room, m, winner.as_deref(), reason, now, false).await?;
    }
    Ok(())
}
// Keep the locked transaction context and frozen room/match/round explicit.
#[allow(clippy::too_many_arguments)]
async fn end_match_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    m: &Match,
    requested_winner: Option<&str>,
    reason: &str,
    now: DateTime<Utc>,
    departure: bool,
) -> Result<(), ApiError> {
    let players = store::match_players(conn, &m.id).await?;
    let winner = if departure
        && (m.scoring_mode == "placement"
            || (m.scoring_mode == "points" && requested_winner.is_none()))
    {
        unique_top(&players)
    } else {
        requested_winner.map(str::to_owned)
    };
    sqlx::query(
        "UPDATE multi_match SET status='finished',ended_at=$2,winner_member_id=$3 WHERE id=$1",
    )
    .bind(&m.id)
    .bind(now)
    .bind(&winner)
    .execute(&mut *conn)
    .await?;
    let end = now + state.config.multi.finished_retention;
    sqlx::query("UPDATE multi_room SET status='finished',expires_at=$2 WHERE id=$1")
        .bind(&room.id)
        .bind(end)
        .execute(&mut *conn)
        .await?;
    let mut p = json!({"matchIndex":m.match_index,"memberScores":projection::scores(&players),"scores":{"slot1":0,"slot2":0},"reason":reason,"retentionEndsAt":end});
    if let Some(winner) = winner {
        p["winnerMemberId"] = json!(winner);
    }
    if m.scoring_mode != "wins" {
        p["ranking"] = ranking(&players);
    }
    events::append_event(conn, &room.id, "match.ended", p, now).await?;
    Ok(())
}
// Keep the locked transaction context and frozen room/match/round explicit.
#[allow(clippy::too_many_arguments)]
async fn end_round_without_score(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    m: &Match,
    round: &Round,
    winner: Option<&str>,
    forfeited: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    if round.status == "ended" {
        return Ok(());
    }
    if m.scoring_mode != "wins" {
        sqlx::query("UPDATE multi_round_player SET status='timed_out',completed_at=$2 WHERE round_id=$1 AND status='active'").bind(&round.id).bind(now).execute(&mut *conn).await?;
    }
    sqlx::query("UPDATE multi_round SET status='ended',ended_at=$2,winner_member_id=$3,winner_slot=(SELECT seat FROM multi_match_player WHERE match_id=$4 AND member_id=$3) WHERE id=$1").bind(&round.id).bind(now).bind(winner).bind(&m.id).execute(&mut *conn).await?;
    let players = store::match_players(conn, &m.id).await?;
    let mut p = json!({"roundId":round.id,"matchIndex":m.match_index,"roundIndex":round.round_index,"answerId":round.answer_id,"memberScores":projection::scores(&players),"scores":{"slot1":0,"slot2":0},"nextStartsAt":now+state.config.multi.intermission});
    if let Some(w) = winner {
        p["winnerMemberId"] = json!(w);
    }
    if let Some(f) = forfeited {
        p["forfeitedMemberId"] = json!(f);
    }
    if m.scoring_mode != "wins" {
        p["placements"]=json!(store::round_players(conn,&round.id).await?.iter().map(|rp|{let mut v=json!({"memberId":rp.member_id,"seat":players.iter().find(|p|p.member_id==rp.member_id).map(|p|p.seat).unwrap_or(0),"status":rp.status,"pointsAwarded":rp.points_awarded});if let Some(rank)=rp.finish_rank{v["finishRank"]=json!(rank);}v}).collect::<Vec<_>>());
    }
    events::append_event(conn, &room.id, "round.ended", p, now).await?;
    Ok(())
}
pub(super) async fn settle_roster(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    round: &Round,
    m: &Match,
    forfeited: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    let active: Vec<_> = store::round_players(conn, &round.id)
        .await?
        .into_iter()
        .filter(|p| p.status == "active")
        .collect();
    if m.scoring_mode != "wins" {
        if active.is_empty() {
            complete_round_tx(state, conn, room, round, m, None, forfeited, now).await?;
        }
        return Ok(());
    }
    let mut end = active.len() <= 1;
    let winner = if active.len() == 1 {
        Some(active[0].member_id.as_str())
    } else {
        None
    };
    if !end {
        let counts:Vec<i64>=sqlx::query_scalar("SELECT count(g.id) FROM multi_round_player p LEFT JOIN multi_guess g ON g.round_id=p.round_id AND g.member_id=p.member_id WHERE p.round_id=$1 AND p.status='active' GROUP BY p.member_id").bind(&round.id).fetch_all(&mut *conn).await?;
        end = !counts.is_empty()
            && counts.len() == active.len()
            && counts
                .iter()
                .all(|n| *n >= matches::max_guesses_for_match(m) as i64);
    }
    if end {
        complete_round_tx(state, conn, room, round, m, winner, forfeited, now).await?;
    }
    Ok(())
}
pub async fn forfeit_member_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    member: &Member,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<RoomEffect, ApiError> {
    forfeit_members_tx(state, conn, room, std::slice::from_ref(member), reason, now).await
}
pub async fn forfeit_members_tx(
    state: &AppState,
    conn: &mut PgConnection,
    input_room: &Room,
    members: &[Member],
    reason: &str,
    now: DateTime<Utc>,
) -> Result<RoomEffect, ApiError> {
    let mut effect = RoomEffect {
        room_id: input_room.id.clone(),
        ..Default::default()
    };
    if members.is_empty() {
        return Ok(effect);
    }
    let round = current_round(conn, &input_room.id).await?;
    let m = if let Some(r) = &round {
        Some(store::match_by_id(conn, &r.match_id, true).await?)
    } else {
        store::latest_match(conn, &input_room.id, true).await?
    };
    let Some(m) = m else { return Ok(effect) };
    let room = store::room(conn, &input_room.id, true).await?;
    if room.status != "playing" || m.status != "playing" || room.mode != "race" {
        return Ok(effect);
    }
    super::validate_ruleset(state, &room, &m)?;
    let mut changed = vec![];
    for member in members {
        if member.room_id != room.id {
            return Err(ApiError::invariant("race member belongs to another room"));
        }
        if reason == "disconnect" {
            // The sweeper's candidate list predates these locks. A reconnect
            // that committed first must retain its place in the frozen roster.
            let current: Member =
                sqlx::query_as("SELECT * FROM multi_member WHERE id=$1 FOR UPDATE")
                    .bind(&member.id)
                    .fetch_one(&mut *conn)
                    .await?;
            if current.status != "disconnected" || current.grace_until.is_none_or(|end| end > now) {
                continue;
            }
        }
        let affected=sqlx::query("UPDATE multi_match_player SET status='left' WHERE match_id=$1 AND member_id=$2 AND status='active'").bind(&m.id).bind(&member.id).execute(&mut *conn).await?.rows_affected();
        if affected == 0 {
            continue;
        }
        changed.push(member);
        if let Some(r) = round.as_ref().filter(|r| r.status != "ended") {
            sqlx::query("UPDATE multi_round_player SET status='forfeited',finish_rank=NULL,points_awarded=0,completed_at=$3 WHERE round_id=$1 AND member_id=$2 AND status IN ('active','correct')").bind(&r.id).bind(&member.id).bind(now).execute(&mut *conn).await?;
        }
        sqlx::query("UPDATE multi_member SET status='left',grace_until=NULL WHERE id=$1")
            .bind(&member.id)
            .execute(&mut *conn)
            .await?;
    }
    if changed.is_empty() {
        return Ok(effect);
    }
    effect
        .forfeits
        .extend(std::iter::repeat_n(reason.to_owned(), changed.len()));
    rooms::append_updated(conn, &room, now).await?;
    effect.game = true;
    let active: Vec<_> = store::match_players(conn, &m.id)
        .await?
        .into_iter()
        .filter(|p| p.status == "active")
        .collect();
    let forfeited = if changed.len() == 1 {
        Some(changed[0].id.as_str())
    } else {
        None
    };
    if active.len() <= 1 {
        if let Some(r) = round.as_ref().filter(|r| r.status != "ended") {
            let remaining: Vec<_> = store::round_players(conn, &r.id)
                .await?
                .into_iter()
                .filter(|p| p.status == "active")
                .collect();
            let winner = if remaining.len() == 1 {
                Some(remaining[0].member_id.as_str())
            } else {
                None
            };
            end_round_without_score(state, conn, &room, &m, r, winner, forfeited, now).await?;
        }
        end_match_tx(
            state,
            conn,
            &room,
            &m,
            active.first().map(|p| p.member_id.as_str()),
            reason,
            now,
            true,
        )
        .await?;
    } else if let Some(r) = round.as_ref().filter(|r| r.status != "ended") {
        settle_roster(state, conn, &room, r, &m, forfeited, now).await?;
    }
    if reason == "disconnect"
        && let Some(r) = &round
    {
        changed.sort_by_key(|m| m.seat());
        for member in changed {
            effect.chat |=
                announcement(state, conn, &room, &m, r, member, "disconnect", now).await?;
        }
    }
    Ok(effect)
}
pub async fn terminate_match_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    m: &Match,
    round: Option<&Round>,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<RoomEffect, ApiError> {
    if m.status != "playing" {
        return Ok(RoomEffect {
            room_id: room.id.clone(),
            ..Default::default()
        });
    }
    if let Some(round) = round {
        end_round_without_score(state, conn, room, m, round, None, None, now).await?;
    }
    end_match_tx(state, conn, room, m, None, reason, now, true).await?;
    Ok(RoomEffect::game(&room.id))
}
pub async fn sweep_room(state: &AppState, room_id: &str) -> Result<RoomEffect, ApiError> {
    let mut effect = RoomEffect {
        room_id: room_id.into(),
        ..Default::default()
    };
    let now = (state.clock)();
    let mut tx = state.pool.begin().await?;
    let Some(round) = current_round(&mut tx, room_id).await? else {
        return Ok(effect);
    };
    let m = store::match_by_id(&mut tx, &round.match_id, true).await?;
    let room = store::room(&mut tx, room_id, true).await?;
    if m.status != "playing" || room.mode != "race" {
        return Ok(effect);
    }
    super::validate_ruleset(state, &room, &m)?;
    // Another sweeper can insert the next round while this statement waits for
    // the previous round lock. Recheck after acquiring the match lock.
    if store::latest_round(&mut tx, &m.id, false)
        .await?
        .is_some_and(|latest| latest.id != round.id)
    {
        tx.commit().await?;
        return Ok(effect);
    }
    match round.status.as_str() {
        "countdown" if now >= round.starts_at => {
            sqlx::query(
                "UPDATE multi_round SET status='playing' WHERE id=$1 AND status='countdown'",
            )
            .bind(&round.id)
            .execute(&mut *tx)
            .await?;
            events::append_event(
                &mut tx,
                room_id,
                "round.playing",
                json!({"matchIndex":m.match_index,"roundIndex":round.round_index}),
                now,
            )
            .await?;
            effect.game = true;
        }
        "playing" if now >= round.deadline => {
            complete_round_tx(state, &mut tx, &room, &round, &m, None, None, now).await?;
            effect.game = true;
        }
        "ended"
            if round
                .ended_at
                .is_some_and(|t| now > t + state.config.multi.intermission) =>
        {
            if m.round_count >= cap(state, &room, &m) {
                end_match_tx(state, &mut tx, &room, &m, None, "round_cap", now, false).await?;
            } else {
                matches::create_round_tx(
                    state,
                    &mut tx,
                    &room,
                    &m,
                    round.round_index + 1,
                    round.ended_at.unwrap() + state.config.multi.intermission,
                    now,
                )
                .await?;
            }
            effect.game = true;
        }
        _ => {}
    }
    tx.commit().await?;
    Ok(effect)
}
// Keep the locked transaction context and frozen room/match/round explicit.
#[allow(clippy::too_many_arguments)]
pub(super) async fn announcement(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    m: &Match,
    round: &Round,
    member: &Member,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<bool, ApiError> {
    let suffix = match reason {
        "correct" => "已猜中",
        "exhausted" => "猜测次数已耗尽",
        "forfeited" => "已放弃本局",
        "disconnect" => "已离线",
        _ => return Err(ApiError::invariant("unknown race completion reason")),
    };
    crate::service::chat::append_system(
        conn,
        state.config.multi.system_announcements_enabled,
        &room.id,
        m.roster_size,
        &format!("race/{}/{}/{reason}", round.id, member.id),
        &format!(
            "[第 {} 轮]{}(P{}){suffix}",
            round.round_index,
            member.display_name,
            member.seat()
        ),
        now,
    )
    .await
}
