//! Relay rules are independent of the transport and storage. The two-player
//! compatibility rule deliberately differs from fixed stages and elimination.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("invalid relay stage plan")]
    Invalid,
    #[error("encounter not found")]
    NotFound,
    #[error("actor not assigned to encounter")]
    NotPlayer,
    #[error("actor does not own turn")]
    NotYourTurn,
    #[error("encounter ended")]
    Ended,
    #[error("encounter has not started")]
    NotActive,
    #[error("turn expired")]
    TurnExpired,
    #[error("invalid guess")]
    InvalidGuess,
    #[error("duplicate guess")]
    DuplicateGuess,
    #[error("idempotency conflict")]
    Idempotency,
    #[error("question pool too small for relay pairings")]
    PoolTooSmall,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub member_id: String,
    pub seat: i32,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pairing {
    pub pairs: Vec<[Player; 2]>,
    pub bye: Option<Player>,
}
pub fn pair(
    active: &[Player],
    previous_bye: Option<&str>,
    random: &dyn Fn(usize) -> usize,
) -> Result<Pairing, Error> {
    if !(2..=8).contains(&active.len())
        || active
            .iter()
            .any(|p| p.member_id.is_empty() || !(1..=8).contains(&p.seat))
        || active.windows(2).any(|p| p[0].seat >= p[1].seat)
        || active
            .iter()
            .map(|p| &p.member_id)
            .collect::<HashSet<_>>()
            .len()
            != active.len()
    {
        return Err(Error::Invalid);
    }
    let mut players = active.to_vec();
    let bye = if players.len() % 2 == 1 {
        let eligible: Vec<_> = players
            .iter()
            .enumerate()
            .filter(|(_, p)| Some(p.member_id.as_str()) != previous_bye)
            .map(|(i, _)| i)
            .collect();
        let draw = draw(random, eligible.len())?;
        Some(players.remove(eligible[draw]))
    } else {
        None
    };
    for i in (1..players.len()).rev() {
        let j = draw(random, i + 1)?;
        players.swap(i, j)
    }
    Ok(Pairing {
        pairs: players
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| [p[0].clone(), p[1].clone()])
            .collect(),
        bye,
    })
}
fn draw(random: &dyn Fn(usize) -> usize, n: usize) -> Result<usize, Error> {
    if n == 0 {
        return Err(Error::Invalid);
    }
    let v = random(n);
    if v < n { Ok(v) } else { Err(Error::Invalid) }
}
pub fn questions(
    candidates: &[String],
    used: &[String],
    count: usize,
    random: &dyn Fn(usize) -> usize,
) -> Result<Vec<String>, Error> {
    let mut pool: Vec<_> = candidates
        .iter()
        .filter(|v| !v.is_empty() && !used.contains(v))
        .cloned()
        .collect();
    pool.sort();
    pool.dedup();
    if pool.len() < count {
        return Err(Error::PoolTooSmall);
    }
    for i in 0..count {
        let j = i + draw(random, pool.len() - i)?;
        pool.swap(i, j)
    }
    pool.truncate(count);
    Ok(pool)
}
pub fn first_turn(stage: i32, pair: &[Player; 2]) -> Result<&Player, Error> {
    if stage < 1
        || pair[0].member_id.is_empty()
        || pair[1].member_id.is_empty()
        || pair[0].member_id == pair[1].member_id
    {
        return Err(Error::Invalid);
    }
    let lower = usize::from(pair[0].seat > pair[1].seat);
    Ok(&pair[if stage % 2 == 1 { lower } else { 1 - lower }])
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    pub index: i32,
    pub member_id: String,
    pub kind: String,
    pub guess_id: Option<String>,
    pub correct: bool,
}
#[derive(Debug, Clone)]
pub struct EncounterState {
    pub ended: bool,
    pub members: [Player; 2],
    pub turn_member_id: String,
    pub max_turns: i32,
    pub turns: Vec<Turn>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transition {
    pub ended: bool,
    pub reason: Option<&'static str>,
    pub winner: Option<String>,
    pub next_member: Option<String>,
    pub next_deadline: Option<DateTime<Utc>>,
}
impl Transition {
    pub fn terminal(reason: &'static str, winner: Option<String>) -> Self {
        Self {
            ended: true,
            reason: Some(reason),
            winner,
            next_member: None,
            next_deadline: None,
        }
    }
}
impl EncounterState {
    pub fn contains(&self, actor: &str) -> bool {
        self.members.iter().any(|p| p.member_id == actor)
    }
    fn other(&self, actor: &str) -> String {
        self.members[usize::from(self.members[0].member_id == actor)]
            .member_id
            .clone()
    }
    pub fn forfeit(&self, actor: &str, legacy_out_of_turn: bool) -> Result<Transition, Error> {
        if self.ended {
            return Err(Error::Ended);
        }
        if !self.contains(actor) {
            return Err(Error::NotPlayer);
        }
        if !legacy_out_of_turn && self.turn_member_id != actor {
            return Err(Error::NotYourTurn);
        }
        Ok(Transition::terminal("forfeit", Some(self.other(actor))))
    }
    pub fn apply(&self, turn: &Turn, next_deadline: DateTime<Utc>) -> Result<Transition, Error> {
        if self.ended {
            return Err(Error::Ended);
        }
        if !self.contains(&turn.member_id) {
            return Err(Error::NotPlayer);
        }
        if self.turn_member_id != turn.member_id {
            return Err(Error::NotYourTurn);
        }
        if self.max_turns <= 0
            || turn.index != self.turns.len() as i32 + 1
            || !matches!(turn.kind.as_str(), "guess" | "pass" | "timeout")
        {
            return Err(Error::Invalid);
        }
        if turn.kind == "guess"
            && self
                .turns
                .iter()
                .any(|t| t.kind == "guess" && t.guess_id == turn.guess_id)
        {
            return Err(Error::DuplicateGuess);
        }
        if turn.correct {
            return Ok(Transition::terminal("win", Some(turn.member_id.clone())));
        }
        if matches!(turn.kind.as_str(), "pass" | "timeout")
            && self
                .turns
                .iter()
                .filter(|t| {
                    t.member_id == turn.member_id && matches!(t.kind.as_str(), "pass" | "timeout")
                })
                .count()
                >= 2
        {
            return Ok(Transition::terminal(
                "loss",
                Some(self.other(&turn.member_id)),
            ));
        }
        let counts: Vec<_> = self
            .members
            .iter()
            .map(|p| {
                self.turns
                    .iter()
                    .filter(|t| t.member_id == p.member_id)
                    .count() as i32
                    + i32::from(turn.member_id == p.member_id)
            })
            .collect();
        if counts.iter().all(|n| *n >= self.max_turns) {
            return Ok(Transition::terminal("draw", None));
        }
        let other = self.other(&turn.member_id);
        let next = if self
            .members
            .iter()
            .position(|p| p.member_id == other)
            .is_some_and(|i| counts[i] >= self.max_turns)
        {
            turn.member_id.clone()
        } else {
            other
        };
        Ok(Transition {
            ended: false,
            reason: None,
            winner: None,
            next_member: Some(next),
            next_deadline: Some(next_deadline),
        })
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    #[serde(flatten)]
    pub player: Player,
    pub score: i32,
    pub life_state: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eliminated_stage: Option<i32>,
}
#[derive(Debug, Clone)]
pub struct Participant {
    pub player: Player,
    pub encounter_id: Option<String>,
    pub outcome: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    #[serde(skip)]
    pub player: Player,
    pub member_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encounter_id: Option<String>,
    pub assignment: &'static str,
    pub outcome: String,
    pub score_before: i32,
    pub score_delta: i32,
    pub score_after: i32,
    pub life_before: String,
    pub life_after: String,
    pub life_transition: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eliminated_stage: Option<i32>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ranking {
    #[serde(flatten)]
    pub standing: Standing,
    pub rank: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub survived_stages: Option<i32>,
}
#[derive(Debug, Clone)]
pub struct MatchDecision {
    pub scores: [i32; 2],
    pub ranking: Vec<Ranking>,
    pub ended: bool,
    pub winner: Option<String>,
    pub reason: String,
}
#[derive(Debug, Clone)]
pub struct Decision {
    pub players: Vec<Settlement>,
    pub standings: Vec<Standing>,
    pub eliminated: Vec<String>,
    pub next: Vec<Player>,
    pub match_decision: Option<MatchDecision>,
}
#[derive(Debug, Clone)]
pub struct ForcedEnd {
    pub winner: Option<String>,
    pub reason: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    Legacy,
    Fixed,
    Elimination,
}
impl Rule {
    pub fn parse(key: &str, version: i32) -> Result<Self, Error> {
        if version != 1 {
            return Err(Error::Invalid);
        }
        match key {
            "legacy_wins" => Ok(Self::Legacy),
            "fixed_points" => Ok(Self::Fixed),
            "elimination" => Ok(Self::Elimination),
            _ => Err(Error::Invalid),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Legacy => "legacy_wins",
            Self::Fixed => "fixed_points",
            Self::Elimination => "elimination",
        }
    }
}
pub fn ranking(
    states: &[Standing],
    rule: Rule,
    completed: i32,
    legacy_winner: Option<&str>,
) -> Result<(Vec<Ranking>, Option<String>), Error> {
    let mut entries = Vec::new();
    let mut survivors = Vec::new();
    for state in states {
        let survived = if rule == Rule::Elimination {
            if completed < 0 {
                return Err(Error::Invalid);
            }
            Some(match state.status.as_str() {
                "active" => {
                    if state.eliminated_stage.is_some() {
                        return Err(Error::Invalid);
                    }
                    survivors.push(state.player.member_id.clone());
                    completed
                }
                "eliminated" | "left" => {
                    let stage = state
                        .eliminated_stage
                        .filter(|s| *s >= 1 && *s <= completed)
                        .ok_or(Error::Invalid)?;
                    stage - i32::from(state.status == "eliminated")
                }
                _ => return Err(Error::Invalid),
            })
        } else {
            None
        };
        entries.push(Ranking {
            standing: state.clone(),
            rank: 0,
            survived_stages: survived,
        })
    }
    entries.sort_by(|a, b| {
        let priority = |v: &Ranking| {
            if rule == Rule::Elimination {
                v.survived_stages.unwrap_or(0)
            } else if rule == Rule::Legacy && legacy_winner.is_some() {
                i32::from(Some(v.standing.player.member_id.as_str()) == legacy_winner)
            } else {
                v.standing.score
            }
        };
        priority(b)
            .cmp(&priority(a))
            .then(a.standing.player.seat.cmp(&b.standing.player.seat))
            .then(
                a.standing
                    .player
                    .member_id
                    .cmp(&b.standing.player.member_id),
            )
    });
    for i in 0..entries.len() {
        entries[i].rank = if rule == Rule::Legacy && legacy_winner.is_some() {
            if Some(entries[i].standing.player.member_id.as_str()) == legacy_winner {
                1
            } else {
                2
            }
        } else if i > 0
            && (if rule == Rule::Elimination {
                entries[i].survived_stages == entries[i - 1].survived_stages
            } else {
                entries[i].standing.score == entries[i - 1].standing.score
            })
        {
            entries[i - 1].rank
        } else {
            i as i32 + 1
        };
    }
    let winner = if rule == Rule::Elimination {
        if survivors.len() == 1 {
            survivors.pop()
        } else {
            None
        }
    } else if !entries.is_empty() && entries.get(1).is_none_or(|v| v.rank != 1) {
        Some(entries[0].standing.player.member_id.clone())
    } else {
        None
    };
    Ok((entries, winner))
}
pub fn settle(
    rule: Rule,
    stage: i32,
    max_stages: i32,
    target_wins: i32,
    states: &[Standing],
    participants: &[Participant],
    forced: Option<&ForcedEnd>,
) -> Result<Decision, Error> {
    if stage < 1
        || match rule {
            Rule::Legacy => {
                states.len() != 2 || participants.len() != 2 || target_wins < 1 || max_stages < 1
            }
            Rule::Fixed => {
                !matches!(states.len(), 4 | 6 | 8) || stage > max_stages || forced.is_some()
            }
            Rule::Elimination => !matches!(states.len(), 4 | 6 | 8) || forced.is_some(),
        }
    {
        return Err(Error::Invalid);
    }
    let mut by_id = BTreeMap::new();
    for s in states {
        if s.player.member_id.is_empty()
            || s.player.seat < 1
            || by_id
                .insert(s.player.member_id.clone(), s.clone())
                .is_some()
        {
            return Err(Error::Invalid);
        }
        if rule == Rule::Fixed
            && (s.life_state != "healthy"
                || s.eliminated_stage.is_some()
                || !matches!(s.status.as_str(), "active" | "left"))
        {
            return Err(Error::Invalid);
        }
        if rule == Rule::Elimination {
            validate_elimination(s, stage)?
        }
    }
    // A batch of permanent departures can remove the last active players in
    // this stage. Their departed settlements still have to commit atomically.
    if rule == Rule::Elimination
        && !states
            .iter()
            .any(|s| matches!(s.status.as_str(), "active" | "left"))
    {
        return Err(Error::Invalid);
    }
    let mut seen = HashSet::new();
    let mut d = Decision {
        players: Vec::new(),
        standings: Vec::new(),
        eliminated: Vec::new(),
        next: Vec::new(),
        match_decision: None,
    };
    for p in participants {
        if !seen.insert(p.player.member_id.clone()) {
            return Err(Error::Invalid);
        }
        let s = by_id.get_mut(&p.player.member_id).ok_or(Error::Invalid)?;
        if s.player != p.player || s.status == "eliminated" {
            return Err(Error::Invalid);
        }
        let bye = p.encounter_id.is_none();
        if bye != (p.outcome == "bye") {
            return Err(Error::Invalid);
        }
        let delta = match p.outcome.as_str() {
            "win" => match rule {
                Rule::Fixed => 2,
                Rule::Legacy => i32::from(forced.is_none()),
                Rule::Elimination => 1,
            },
            "loss" => {
                if rule == Rule::Elimination {
                    -stage
                } else {
                    0
                }
            }
            "draw" => match rule {
                Rule::Fixed => 1,
                Rule::Elimination => -(stage / 2),
                Rule::Legacy => 0,
            },
            "bye" => 0,
            _ => return Err(Error::Invalid),
        };
        let mut after = s.score + delta;
        let mut life = s.life_state.clone();
        let mut eliminated = s.eliminated_stage;
        let mut transition = "none";
        if rule == Rule::Elimination {
            if bye {
                after = s.score
            } else if s.status == "left" {
                if s.life_state == "near_death" && delta > 0 {
                    after = s.score
                } else if delta > 0 {
                    after = after.min(10)
                }
            } else if s.life_state == "near_death" {
                if delta > 0 {
                    after = s.score
                } else if delta < 0 {
                    transition = "eliminated";
                    eliminated = Some(stage);
                    s.status = "eliminated".into();
                    d.eliminated.push(s.player.member_id.clone())
                }
            } else if after <= 0 {
                after = 0;
                life = "near_death".into();
                transition = "entered_near_death"
            } else {
                after = after.min(10)
            }
        }
        d.players.push(Settlement {
            player: p.player.clone(),
            member_id: p.player.member_id.clone(),
            encounter_id: p.encounter_id.clone(),
            assignment: if bye { "bye" } else { "paired" },
            outcome: p.outcome.clone(),
            score_before: s.score,
            score_delta: after - s.score,
            score_after: after,
            life_before: s.life_state.clone(),
            life_after: life.clone(),
            life_transition: transition,
            eliminated_stage: eliminated,
        });
        s.score = after;
        s.life_state = life;
        s.eliminated_stage = eliminated;
    }
    if rule != Rule::Legacy
        && by_id
            .values()
            .any(|s| s.status == "active" && !seen.contains(&s.player.member_id))
    {
        return Err(Error::Invalid);
    }
    d.standings = by_id.into_values().collect();
    d.standings.sort_by_key(|s| s.player.seat);
    d.players.sort_by_key(|s| s.player.seat);
    d.eliminated.sort_by_key(|id| {
        d.standings
            .iter()
            .find(|s| s.player.member_id == *id)
            .map(|s| s.player.seat)
    });
    let active: Vec<_> = d
        .standings
        .iter()
        .filter(|s| s.status == "active")
        .map(|s| s.player.clone())
        .collect();
    if rule == Rule::Legacy {
        let mut scores = [0; 2];
        for s in &d.standings {
            if (1..=2).contains(&s.player.seat) {
                scores[s.player.seat as usize - 1] = s.score
            }
        }
        let (ended, winner, reason) = if let Some(f) = forced {
            if f.reason.is_empty()
                || f.winner
                    .as_ref()
                    .is_some_and(|id| !states.iter().any(|s| &s.player.member_id == id))
            {
                return Err(Error::Invalid);
            }
            (true, f.winner.clone(), f.reason.clone())
        } else {
            let ended = scores.iter().any(|s| *s >= target_wins) || stage >= max_stages;
            let winner = if ended {
                d.standings
                    .iter()
                    .find(|s| s.score >= target_wins)
                    .map(|s| s.player.member_id.clone())
            } else {
                None
            };
            let reason = if ended && winner.is_none() {
                "round_cap"
            } else {
                "normal"
            };
            (ended, winner, reason.into())
        };
        if !ended {
            d.next = d.standings.iter().map(|s| s.player.clone()).collect()
        }
        d.match_decision = Some(MatchDecision {
            scores,
            ranking: if ended {
                ranking(&d.standings, rule, stage, winner.as_deref())?.0
            } else {
                Vec::new()
            },
            ended,
            winner,
            reason,
        });
    } else if (rule == Rule::Fixed && active.len() >= 2 && stage < max_stages)
        || (rule == Rule::Elimination && active.len() > 1)
    {
        d.next = active
    } else {
        let (ranking, winner) = ranking(&d.standings, rule, stage, None)?;
        d.match_decision = Some(MatchDecision {
            scores: [0; 2],
            ranking,
            ended: true,
            winner,
            reason: if rule == Rule::Fixed && active.len() < 2 {
                "insufficient_active_players"
            } else {
                "normal"
            }
            .into(),
        })
    }
    Ok(d)
}
fn validate_elimination(s: &Standing, stage: i32) -> Result<(), Error> {
    if s.player.seat > 8 || !matches!(s.life_state.as_str(), "healthy" | "near_death") {
        return Err(Error::Invalid);
    }
    let valid = match s.status.as_str() {
        "active" => {
            s.eliminated_stage.is_none()
                && s.score <= 10
                && if s.life_state == "healthy" {
                    s.score >= 0
                } else {
                    s.score == 0
                }
        }
        "eliminated" => {
            s.life_state == "near_death"
                && s.score < 0
                && s.eliminated_stage.is_some_and(|n| n >= 1 && n < stage)
        }
        "left" => s.eliminated_stage.is_some_and(|n| n >= 1 && n <= stage),
        _ => false,
    };
    if valid { Ok(()) } else { Err(Error::Invalid) }
}
