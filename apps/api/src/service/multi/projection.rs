//! One observer projection for snapshots, replay and live delivery.
use crate::{
    app::AppState,
    error::ApiError,
    game::*,
    repository::{models::*, multi as store},
    service::{
        catalog,
        multi::{matches, relay},
    },
};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::PgConnection;
pub const PROJECTION_SCHEMA_VERSION: &str = "opponent-board-v1";
/// Go math/rand/v2 PCG-DXSM and bounded multiplication are wire compatibility,
/// since changing the generator would change existing observers' column maps.
struct GoPcg(u128);
impl GoPcg {
    fn next(&mut self) -> u64 {
        const MUL: u128 = ((2549297995355413924u128) << 64) | 4865540595714422341;
        const INC: u128 = ((6364136223846793005u128) << 64) | 1442695040888963407;
        self.0 = self.0.wrapping_mul(MUL).wrapping_add(INC);
        let mut hi = (self.0 >> 64) as u64;
        let lo = self.0 as u64;
        hi ^= hi >> 32;
        hi = hi.wrapping_mul(0xda942042e4dd58b5);
        hi ^= hi >> 48;
        hi.wrapping_mul(lo | 1)
    }
    fn bounded(&mut self, n: u64) -> usize {
        if n.is_power_of_two() {
            return (self.next() & (n - 1)) as usize;
        }
        let threshold = n.wrapping_neg() % n;
        loop {
            let product = (self.next() as u128) * (n as u128);
            if product as u64 >= threshold {
                return (product >> 64) as usize;
            }
        }
    }
}
pub fn column_permutation(
    secret: &[u8],
    round: &str,
    observer: &str,
    subject: &str,
    n: usize,
) -> Vec<usize> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts any key");
    for part in [round, observer, subject, PROJECTION_SCHEMA_VERSION] {
        mac.update(&(part.len() as u32).to_be_bytes());
        mac.update(part.as_bytes());
    }
    let digest = mac.finalize().into_bytes();
    let mut rng = GoPcg(u128::from_be_bytes(digest[..16].try_into().unwrap()));
    let mut order: Vec<_> = (0..n).collect();
    for i in (1..n).rev() {
        let j = rng.bounded((i + 1) as u64);
        order.swap(i, j);
    }
    order
}
pub fn statuses_for_fields(statuses: &[String], fields: &[GuessField]) -> Vec<String> {
    if statuses.len() == fields.len() {
        return statuses.to_vec();
    }
    let full = character_guess_fields();
    fields
        .iter()
        .enumerate()
        .map(|(i, f)| {
            full.iter()
                .position(|x| x.key == f.key)
                .and_then(|j| statuses.get(j))
                .or_else(|| statuses.get(i))
                .cloned()
                .unwrap_or_else(|| "miss".into())
        })
        .collect()
}
pub fn hydrate_guess(
    character: &Character,
    statuses: &[String],
    correct: bool,
    fields: &[GuessField],
    kind: MatchKind,
) -> Value {
    let statuses = statuses_for_fields(statuses, fields);
    let feedback:Vec<_>=fields.iter().enumerate().filter(|(_,f)|f.visible).map(|(i,f)|{let status:FeedbackStatus=serde_json::from_value(json!(statuses.get(i).map(String::as_str).unwrap_or("miss"))).unwrap_or(FeedbackStatus::Miss);json!({"field":f.key,"label":f.label,"status":status,"symbol":status_to_symbol(status),"displayValue":display_values_for_field(character,&f.key)})}).collect();
    let mut value = json!({"kind":"guess","guessId":character.id,"guessName":character.names.zh_hans,"isCorrect":correct,"matchKind":kind,"feedback":feedback});
    if !character.avatar_url.is_empty() {
        value["guessAvatarUrl"] = json!(character.avatar_url);
    }
    value
}
/// Durable events use the historical GuessResultView; REST has a kind discriminator.
fn hydrate_event_guess(
    character: &Character,
    statuses: &[String],
    correct: bool,
    fields: &[GuessField],
    kind: MatchKind,
) -> Value {
    let mut value = hydrate_guess(character, statuses, correct, fields, kind);
    value.as_object_mut().unwrap().remove("kind");
    value
}
pub fn answer_view(character: &Character) -> Value {
    let mut value = json!({"id":character.id,"name":character.names.zh_hans,"workId":character.first_appearance.work_id,"workTitle":character.first_appearance.work_title,"workCode":character.first_appearance.mainline_index.map(|v|format!("TH{v:02}")).unwrap_or_else(||"TH--".into())});
    if !character.avatar_url.is_empty() {
        value["avatarUrl"] = json!(character.avatar_url);
    }
    value
}
pub fn scores(players: &[MatchPlayer]) -> Value {
    json!(players.iter().map(|p|{let mut v=json!({"memberId":p.member_id,"seat":p.seat,"score":p.score,"status":p.status,"bestRoundScore":p.best_round_score});if let Some(round)=p.eliminated_round{v["eliminatedRound"]=json!(round);}v}).collect::<Vec<_>>())
}
pub fn envelope(event: &RoomEvent, event_type: &str, payload: Option<Value>) -> Value {
    let mut value = json!({"type":event_type,"eventId":event.id.to_string(),"roomId":event.room_id,"sequence":event.sequence,"occurredAt":event.occurred_at});
    if let Some(payload) = payload {
        value["payload"] = payload;
    }
    value
}
pub async fn project_event(
    state: &AppState,
    event: &RoomEvent,
    viewer: &Member,
) -> Result<Value, ApiError> {
    let mut conn = state.pool.acquire().await?;
    project_event_tx(state, &mut conn, event, viewer).await
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn statuses(v: &Value) -> Result<Vec<String>, ApiError> {
    Ok(serde_json::from_value(v.clone())?)
}
pub async fn project_event_tx(
    state: &AppState,
    conn: &mut PgConnection,
    event: &RoomEvent,
    viewer: &Member,
) -> Result<Value, ApiError> {
    let p = &event.payload;
    let mut event_type = event.event_type.as_str();
    let payload = match event_type {
        "round.opponent.guess" => {
            let m: Match = sqlx::query_as!(
                Match,
                r#"
                SELECT id, room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count,
                status, started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size,
                max_rounds, rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy FROM
                multi_match WHERE room_id=$1 AND match_index=$2
                "#,
                &event.room_id,
                p["matchIndex"].as_i64().unwrap_or(0) as i32,
            ).fetch_one(&mut *conn).await?;
            let roster = store::match_players(conn, &m.id).await?;
            let read_only = viewer.is_spectator()
                || roster
                    .iter()
                    .any(|player| player.member_id == viewer.id && player.status != "active");
            let subject = text(p, "memberId");
            let fields = matches::fields_for_match(&m);
            let raw = statuses(&p["statuses"])?;
            if read_only {
                event_type = "round.spectator.guess";
                let round = store::round_by_id(conn, text(p, "roundId"), false).await?;
                let guess: Option<Guess> = sqlx::query_as!(
                    Guess,
                    r#"
                    SELECT id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key, created_at
                    FROM multi_guess WHERE round_id=$1 AND member_id=$2 AND sequence=$3
                    "#,
                    &round.id,
                    subject,
                    p["rowIndex"].as_i64().unwrap_or(0) as i32,
                ).fetch_optional(&mut *conn).await?;
                let id = guess
                    .as_ref()
                    .map(|g| g.guess_id.as_str())
                    .unwrap_or(text(p, "guessId"));
                let chars = catalog::characters_for_version(conn, &m.catalog_version).await?;
                let c = chars
                    .iter()
                    .find(|c| c.id == id)
                    .ok_or_else(|| ApiError::invariant("event guess character missing"))?;
                let correct = guess.as_ref().is_some_and(|g| g.is_correct);
                let raw = guess
                    .as_ref()
                    .map(|g| statuses(&g.statuses))
                    .transpose()?
                    .unwrap_or(raw);
                json!({"matchIndex":p["matchIndex"],"roundIndex":p["roundIndex"],"memberId":subject,"seat":p["memberSlot"],"rowIndex":p["rowIndex"],"guess":hydrate_event_guess(c,&raw,correct,&fields,match_kind_for_stored_guess(correct,&round.answer_id,id))})
            } else if subject == viewer.id || p["memberSlot"].as_i64() == Some(viewer.seat() as i64)
            {
                return Ok(envelope(event, "room.cursor", None));
            } else {
                let perm = column_permutation(
                    &state.config.multi.projection_secret,
                    text(p, "roundId"),
                    &viewer.id,
                    subject,
                    fields.len(),
                );
                let raw = statuses_for_fields(&raw, &fields);
                json!({"matchIndex":p["matchIndex"],"roundIndex":p["roundIndex"],"memberId":subject,"seat":p["memberSlot"],"rowIndex":p["rowIndex"],"fieldOrder":perm.iter().map(|&i|&fields[i].key).collect::<Vec<_>>(),"statuses":perm.iter().map(|&i|&raw[i]).collect::<Vec<_>>()})
            }
        }
        "round.ended" | "match.ended" => {
            let members = store::members(conn, &event.room_id).await?;
            let winner = p
                .get("winnerMemberId")
                .filter(|v| v.is_string())
                .cloned()
                .or_else(|| {
                    p["winnerSlot"].as_i64().and_then(|seat| {
                        members
                            .iter()
                            .find(|m| m.seat() == seat as i32)
                            .map(|m| json!(m.id))
                    })
                })
                .unwrap_or(Value::Null);
            let rankings = p
                .get("relay")
                .and_then(|r| r.get("ranking"))
                .or_else(|| p.get("ranking"))
                .and_then(Value::as_array);
            let results: Vec<_> = members
                .iter()
                .map(|member| {
                    let result = if let Some(w) = winner.as_str() {
                        if member.id == w { "win" } else { "loss" }
                    } else if let Some(ranking) = rankings.filter(|r| !r.is_empty()) {
                        if ranking
                            .iter()
                            .find(|r| r["memberId"] == member.id)
                            .is_some_and(|r| r["rank"] == 1)
                        {
                            "draw"
                        } else {
                            "loss"
                        }
                    } else {
                        "draw"
                    };
                    json!({"memberId":member.id,"seat":member.seat(),"result":result})
                })
                .collect();
            let scores=p.get("memberScores").filter(|v|v.as_array().is_some_and(|a|!a.is_empty())).cloned().unwrap_or_else(||json!(members.iter().map(|m|json!({"memberId":m.id,"seat":m.seat(),"score":p["scores"][if m.seat()==1{"slot1"}else{"slot2"}].as_i64().unwrap_or(0),"status":"active","bestRoundScore":0})).collect::<Vec<_>>()));
            let mut v = json!({"matchIndex":p["matchIndex"],"winnerMemberId":winner,"scores":scores,"results":results});
            if viewer.is_player()
                && let Some(result) = results.iter().find(|r| r["memberId"] == viewer.id)
            {
                v["viewerResult"] = result["result"].clone();
            }
            if event_type == "match.ended" {
                for key in ["reason", "retentionEndsAt", "ranking", "relay"] {
                    if let Some(value) = p.get(key) {
                        v[key] = value.clone();
                    }
                }
            } else {
                let round = store::round_by_id(conn, text(p, "roundId"), false).await?;
                let m = store::match_by_id(conn, &round.match_id, false).await?;
                let chars = catalog::characters_for_version(conn, &m.catalog_version).await?;
                let answer = chars
                    .iter()
                    .find(|c| c.id == text(p, "answerId"))
                    .ok_or_else(|| ApiError::invariant("event answer character missing"))?;
                let guesses = store::guesses(conn, &round.id).await?;
                v["roundIndex"] = p["roundIndex"].clone();
                v["answer"] = answer_view(answer);
                v["boards"] = boards(
                    &members,
                    &guesses,
                    &chars,
                    &matches::fields_for_match(&m),
                    &round.answer_id,
                )?;
                for board in v["boards"].as_array_mut().unwrap() {
                    for guess in board["guesses"].as_array_mut().unwrap() {
                        guess.as_object_mut().unwrap().remove("kind");
                    }
                }
                for key in [
                    "forfeitedMemberId",
                    "nextStartsAt",
                    "placements",
                    "eliminatedMemberIds",
                ] {
                    if let Some(value) = p.get(key) {
                        v[key] = value.clone();
                    }
                }
                if v.get("forfeitedMemberId").is_none()
                    && let Some(seat) = p["forfeitedSlot"].as_i64()
                    && let Some(member) = members.iter().find(|m| m.seat() == seat as i32)
                {
                    v["forfeitedMemberId"] = json!(member.id);
                }
                let turns: Vec<Value> = sqlx::query_scalar!(
                    r#"
                    SELECT to_jsonb(t) AS "value!" FROM multi_turn t WHERE round_id=$1 ORDER BY turn_index
                    "#,
                    &round.id,
                ).fetch_all(&mut *conn).await?;
                if !turns.is_empty() {
                    let mut rows = vec![];
                    for turn in turns {
                        let mut row = json!({"index":turn["turn_index"],"memberId":turn["member_id"],"seat":members.iter().find(|m|m.id==text(&turn,"member_id")).map(Member::seat).unwrap_or(0),"kind":turn["kind"]});
                        if turn["kind"] == "guess" {
                            let c = chars
                                .iter()
                                .find(|c| c.id == text(&turn, "guess_id"))
                                .ok_or_else(|| {
                                    ApiError::invariant("legacy relay guess character missing")
                                })?;
                            let correct = turn["is_correct"].as_bool().unwrap_or(false);
                            row["guess"] = hydrate_event_guess(
                                c,
                                &statuses(&turn["statuses"])?,
                                correct,
                                &matches::fields_for_match(&m),
                                match_kind_for_stored_guess(correct, &round.answer_id, &c.id),
                            );
                        }
                        rows.push(row);
                    }
                    v["turns"] = json!(rows);
                }
            }
            v
        }
        "match.started" => {
            let mut v = p.clone();
            if v.get("activeFields")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
            {
                let scope: QuestionScopeConfig =
                    serde_json::from_value(v["questionScope"].clone())?;
                v["activeFields"] = json!(fields_for_question_scope(&scope));
            }
            if v.get("ruleSetRef").is_none() {
                let mode = text(&v, "mode");
                let scoring = text(&v, "scoringMode");
                let key = if mode == "race" && ["wins", "points", "placement"].contains(&scoring) {
                    scoring
                } else if mode == "relay" && scoring == "wins" {
                    "legacy_wins"
                } else {
                    return Err(ApiError::invariant("unknown projected ruleset"));
                };
                v["ruleSetRef"] = json!({"mode":mode,"key":key,"version":1});
            }
            v
        }
        t if t.starts_with("relay.") => relay::project_payload(t, p, viewer)?,
        _ => p.clone(),
    };
    Ok(envelope(event, event_type, Some(payload)))
}
pub fn boards(
    members: &[Member],
    guesses: &[Guess],
    characters: &[Character],
    fields: &[GuessField],
    answer_id: &str,
) -> Result<Value, ApiError> {
    let mut boards = vec![];
    for member in members {
        let mut rows = vec![];
        for guess in guesses.iter().filter(|g| g.member_id == member.id) {
            let c = characters
                .iter()
                .find(|c| c.id == guess.guess_id)
                .ok_or_else(|| ApiError::invariant("history guess character missing"))?;
            rows.push(hydrate_guess(
                c,
                &statuses(&guess.statuses)?,
                guess.is_correct,
                fields,
                match_kind_for_stored_guess(guess.is_correct, answer_id, &guess.guess_id),
            ));
        }
        boards.push(json!({"memberId":member.id,"seat":member.seat(),"guesses":rows}));
    }
    Ok(json!(boards))
}
