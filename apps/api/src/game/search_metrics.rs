//! Fixed-cardinality search telemetry. Request text, catalog versions and game
//! identifiers never become metric labels, including on error paths.
use std::{
    collections::BTreeMap,
    fmt::Write,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

const BOUNDS: [f64; 11] = [
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0,
];
#[derive(Default)]
struct Histogram {
    count: u64,
    sum: f64,
    buckets: [u64; 11],
}
#[derive(Default)]
struct Data {
    counters: BTreeMap<&'static str, BTreeMap<&'static str, u64>>,
    histograms: BTreeMap<&'static str, Histogram>,
}
#[derive(Default)]
pub struct SearchMetrics(Mutex<Data>);
pub static SEARCH_METRICS: LazyLock<Arc<SearchMetrics>> =
    LazyLock::new(|| Arc::new(SearchMetrics::default()));
fn outcome(value: &str) -> &'static str {
    match value {
        "hit" => "hit",
        "miss" => "miss",
        "load_success" => "load_success",
        "load_error" => "load_error",
        "coalesced" => "coalesced",
        "build_success" => "build_success",
        "build_error" => "build_error",
        "success" => "success",
        "error" => "error",
        "unsupported_schema" => "unsupported_schema",
        _ => "unknown",
    }
}
impl SearchMetrics {
    fn increment(&self, name: &'static str, label: &'static str) {
        *self
            .0
            .lock()
            .expect("search metrics poisoned")
            .counters
            .entry(name)
            .or_default()
            .entry(label)
            .or_default() += 1;
    }
    pub fn inc_policy_outcome(&self, value: &str) {
        self.increment("policy", outcome(value));
    }
    pub fn inc_provider_outcome(&self, layer: &str, value: &str) {
        self.increment(
            match layer {
                "source" => "source",
                "snapshot" => "snapshot",
                _ => "unknown",
            },
            outcome(value),
        );
    }
    pub fn inc_fallback_reason(&self, value: &str) {
        self.increment(
            "fallback_reason",
            match value.trim() {
                "" | "none" => "none",
                "policy_remote" => "policy_remote",
                "policy_unavailable" => "policy_unavailable",
                "context_incomplete" => "context_incomplete",
                "index_transient" => "index_transient",
                "index_invalid" => "index_invalid",
                "engine_error" => "engine_error",
                _ => "unknown",
            },
        );
    }
    pub fn inc_remote_outcome(&self, value: &str) {
        self.increment("remote", outcome(value));
    }
    fn observe(&self, name: &'static str, duration: Duration) {
        let value = duration.as_secs_f64();
        let mut data = self.0.lock().expect("search metrics poisoned");
        let histogram = data.histograms.entry(name).or_default();
        histogram.count += 1;
        histogram.sum += value;
        for (index, bound) in BOUNDS.into_iter().enumerate() {
            if value <= bound {
                histogram.buckets[index] += 1;
            }
        }
    }
    pub fn observe_index_build(&self, duration: Duration) {
        self.observe("index_build_seconds", duration);
    }
    pub fn observe_remote_latency(&self, duration: Duration) {
        self.observe("remote_latency_seconds", duration);
    }
    pub fn prometheus_text(&self) -> String {
        let data = self.0.lock().expect("search metrics poisoned");
        let mut output = String::new();
        for (family, help, label) in [
            ("policy", "Search policy outcomes.", "outcome"),
            ("source", "Search provider outcomes by layer.", "outcome"),
            ("snapshot", "Search snapshot provider outcomes.", "outcome"),
            (
                "fallback_reason",
                "Remote search fallback reasons.",
                "reason",
            ),
            ("remote", "Remote search outcomes.", "outcome"),
        ] {
            let name = format!("touhouflandre_search_{family}_total");
            writeln!(output, "# HELP {name} {help}\n# TYPE {name} counter").unwrap();
            if let Some(values) = data.counters.get(family) {
                for (value, count) in values {
                    writeln!(output, "{name}{{{label}=\"{value}\"}} {count}").unwrap();
                }
            }
        }
        for family in ["index_build_seconds", "remote_latency_seconds"] {
            let name = format!("touhouflandre_search_{family}");
            writeln!(
                output,
                "# HELP {name} Search {}.\n# TYPE {name} histogram",
                family.replace('_', " ")
            )
            .unwrap();
            let Some(histogram) = data.histograms.get(family) else {
                continue;
            };
            for (index, bound) in BOUNDS.into_iter().enumerate() {
                writeln!(
                    output,
                    "{name}_bucket{{le=\"{bound}\"}} {}",
                    histogram.buckets[index]
                )
                .unwrap();
            }
            writeln!(
                output,
                "{name}_bucket{{le=\"+Inf\"}} {}\n{name}_sum {}\n{name}_count {}",
                histogram.count, histogram.sum, histogram.count
            )
            .unwrap();
        }
        output
    }
}
