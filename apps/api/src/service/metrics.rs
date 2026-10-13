use crate::{
    app::AppState,
    metrics::{Labels, METRICS},
};
pub async fn collect(state: &AppState) -> String {
    let mut output = METRICS.text();
    output.push_str(&crate::game::SEARCH_METRICS.prometheus_text());
    for (name, allowed) in [
        ("rooms", &["lobby", "playing", "finished", "closed"][..]),
        ("members", &["connected", "disconnected", "left"][..]),
    ] {
        output.push_str(&format!("# TYPE touhouflandre_multi_{name} gauge\n"));
        struct StatusCount {
            status: String,
            count: i64,
        }
        let rows = match name {
            "rooms" => {
                sqlx::query_as!(
                    StatusCount,
                    r#"
                SELECT status, count(*)::bigint AS "count!" FROM multi_room GROUP BY status
                "#,
                )
                .fetch_all(&state.pool)
                .await
            }
            _ => {
                sqlx::query_as!(
                    StatusCount,
                    r#"
                SELECT status, count(*)::bigint AS "count!" FROM multi_member GROUP BY status
                "#,
                )
                .fetch_all(&state.pool)
                .await
            }
        };
        if let Ok(rows) = rows {
            for StatusCount { status, count } in rows {
                let status = if allowed.contains(&status.as_str()) {
                    status.as_str()
                } else {
                    "unknown"
                };
                output.push_str(&format!(
                    "touhouflandre_multi_{name}{{status=\"{status}\"}} {count}\n"
                ));
            }
        }
    }
    let active = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "value!" FROM multi_round WHERE status IN ('countdown', 'playing')
        "#,
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);
    output.push_str(&format!("# TYPE touhouflandre_multi_ws_connections gauge\ntouhouflandre_multi_ws_connections {}\n# TYPE touhouflandre_multi_active_rounds gauge\ntouhouflandre_multi_active_rounds {active}\n",state.realtime.connection_count()));
    output.push_str("# TYPE touhouflandre_multi_active_encounters gauge\n");
    if let Ok(rows) = sqlx::query!(
        r#"
        SELECT m.rule_set_key, m.rule_set_version, count(*)::bigint AS "count!" FROM multi_relay_encounter e
        JOIN multi_match m ON m.id=e.match_id WHERE m.status='playing' AND e.status<>'ended' GROUP BY
        m.rule_set_key, m.rule_set_version
        "#,
    ).fetch_all(&state.pool).await {
        for row in rows {
            output.push_str(&format!(
                "touhouflandre_multi_active_encounters{} {}\n",
                Labels::new("relay", &row.rule_set_key, row.rule_set_version).text(None),
                row.count
            ));
        }
    }
    output
}
