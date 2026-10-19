//! Prometheus families preserve the existing names with bounded, non-identifying labels.

use std::{
    collections::BTreeMap,
    sync::{LazyLock, Mutex},
};
const BOUNDS: &[f64] = &[
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0, 60.0, 300.0, 1500.0,
    65536.0, 262144.0, 1048576.0,
];
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Labels {
    mode: String,
    rule_set_key: String,
    rule_set_version: i32,
}
impl Labels {
    pub fn new(mode: &str, key: &str, version: i32) -> Self {
        if matches!(mode, "race" | "relay")
            && matches!(
                key,
                "wins" | "points" | "placement" | "legacy_wins" | "fixed_points" | "elimination"
            )
            && version == 1
        {
            Self {
                mode: mode.into(),
                rule_set_key: key.into(),
                rule_set_version: version,
            }
        } else {
            Self {
                mode: "unknown".into(),
                rule_set_key: "unknown".into(),
                rule_set_version: 0,
            }
        }
    }
    pub(crate) fn text(&self, extra: Option<&str>) -> String {
        let mut text = format!(
            "mode=\"{}\",rule_set_key=\"{}\",rule_set_version=\"{}\"",
            self.mode, self.rule_set_key, self.rule_set_version
        );
        if let Some(bucket) = extra {
            text.push_str(&format!(",le=\"{bucket}\""));
        }
        format!("{{{text}}}")
    }
}
#[derive(Default)]
struct Histogram {
    count: u64,
    sum: f64,
    buckets: [u64; 19],
}
#[derive(Default)]
struct Data {
    events: BTreeMap<String, u64>,
    forfeits: BTreeMap<String, u64>,
    reconnects: u64,
    counters: BTreeMap<(String, Labels), u64>,
    histograms: BTreeMap<(String, Labels), Histogram>,
}
#[derive(Default)]
pub struct Metrics(Mutex<Data>);
pub static METRICS: LazyLock<Metrics> = LazyLock::new(Metrics::default);
impl Metrics {
    pub fn event(&self, kind: &str) {
        let kind = if [
            "room.updated",
            "match.started",
            "match.rematch",
            "round.started",
            "round.playing",
            "round.opponent.guess",
            "round.spectator.guess",
            "round.shared.guess",
            "round.turn.timeout",
            "round.turn.pass",
            "round.ended",
            "match.ended",
            "room.closed",
            "relay.stage.started",
            "relay.encounter.started",
            "relay.encounter.turn.guess",
            "relay.encounter.turn.pass",
            "relay.encounter.turn.timeout",
            "relay.encounter.ended",
            "relay.stage.ended",
        ]
        .contains(&kind)
        {
            kind
        } else {
            "unknown"
        };
        *self
            .0
            .lock()
            .expect("metrics poisoned")
            .events
            .entry(kind.into())
            .or_default() += 1;
    }
    pub fn forfeit(&self, reason: &str) {
        let reason = if ["forfeit", "disconnect", "leave", "round_forfeit"].contains(&reason) {
            reason
        } else {
            "unknown"
        };
        *self
            .0
            .lock()
            .expect("metrics poisoned")
            .forfeits
            .entry(reason.into())
            .or_default() += 1;
    }
    pub fn reconnect(&self) {
        self.0.lock().expect("metrics poisoned").reconnects += 1;
    }
    pub fn increment(&self, name: &str, labels: Labels) {
        if [
            "turn_timeouts_total",
            "pairing_failures_total",
            "pool_too_small_total",
            "settlement_retries_total",
            "deadlocks_total",
            "ws_queue_drops_total",
        ]
        .contains(&name)
        {
            *self
                .0
                .lock()
                .expect("metrics poisoned")
                .counters
                .entry((name.into(), labels))
                .or_default() += 1;
        }
    }
    pub fn observe(&self, name: &str, labels: Labels, value: f64) {
        if !value.is_finite()
            || ![
                "guess_latency_seconds",
                "stage_duration_seconds",
                "encounter_duration_seconds",
                "stage_barrier_wait_seconds",
                "history_latency_seconds",
                "snapshot_bytes",
                "ws_payload_bytes",
            ]
            .contains(&name)
        {
            return;
        }
        let mut data = self.0.lock().expect("metrics poisoned");
        let hist = data.histograms.entry((name.into(), labels)).or_default();
        let value = value.max(0.0);
        hist.count += 1;
        hist.sum += value;
        for (index, bound) in BOUNDS.iter().enumerate() {
            if value <= *bound {
                hist.buckets[index] += 1;
            }
        }
    }
    pub(crate) fn text(&self) -> String {
        let data = self.0.lock().expect("metrics poisoned");
        let mut output = format!(
            "# TYPE touhouflandre_multi_reconnects_total counter\ntouhouflandre_multi_reconnects_total {}\n",
            data.reconnects
        );
        for (name, label, values) in [
            ("events_total", "type", &data.events),
            ("forfeits_total", "reason", &data.forfeits),
        ] {
            output.push_str(&format!("# TYPE touhouflandre_multi_{name} counter\n"));
            for (value, count) in values {
                output.push_str(&format!(
                    "touhouflandre_multi_{name}{{{label}=\"{value}\"}} {count}\n"
                ));
            }
        }
        for name in [
            "turn_timeouts_total",
            "pairing_failures_total",
            "pool_too_small_total",
            "settlement_retries_total",
            "deadlocks_total",
            "ws_queue_drops_total",
        ] {
            output.push_str(&format!("# TYPE touhouflandre_multi_{name} counter\n"));
            for ((key, labels), count) in &data.counters {
                if key == name {
                    output.push_str(&format!(
                        "touhouflandre_multi_{name}{} {count}\n",
                        labels.text(None)
                    ));
                }
            }
        }
        for name in [
            "guess_latency_seconds",
            "stage_duration_seconds",
            "encounter_duration_seconds",
            "stage_barrier_wait_seconds",
            "history_latency_seconds",
            "snapshot_bytes",
            "ws_payload_bytes",
        ] {
            output.push_str(&format!("# TYPE touhouflandre_multi_{name} histogram\n"));
            for ((key, labels), hist) in &data.histograms {
                if key != name {
                    continue;
                }
                for (index, bound) in BOUNDS.iter().enumerate() {
                    output.push_str(&format!(
                        "touhouflandre_multi_{name}_bucket{} {}\n",
                        labels.text(Some(&bound.to_string())),
                        hist.buckets[index]
                    ));
                }
                output.push_str(&format!("touhouflandre_multi_{name}_bucket{} {}\ntouhouflandre_multi_{name}_sum{} {}\ntouhouflandre_multi_{name}_count{} {}\n",labels.text(Some("+Inf")),hist.count,labels.text(None),hist.sum,labels.text(None),hist.count));
            }
        }
        output
    }
}
