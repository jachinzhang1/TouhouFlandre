use crate::{
    app::AppState,
    metrics::{Labels, METRICS},
};
pub async fn collect(state: &AppState) -> String {
    let mut output = METRICS.text();
    output.push_str(&crate::game::SEARCH_METRICS.prometheus_text());
    for (name, query, allowed) in [
        (
            "rooms",
            "SELECT status,count(*)::bigint FROM multi_room GROUP BY status",
            &["lobby", "playing", "finished", "closed"][..],
        ),
        (
            "members",
            "SELECT status,count(*)::bigint FROM multi_member GROUP BY status",
            &["connected", "disconnected", "left"][..],
        ),
    ] {
        output.push_str(&format!("# TYPE touhouflandre_multi_{name} gauge\n"));
        if let Ok(rows) = sqlx::query_as::<_, (String, i64)>(sqlx::AssertSqlSafe(query))
            .fetch_all(&state.pool)
            .await
        {
            for (status, count) in rows {
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
    let active = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM multi_round WHERE status IN ('countdown','playing')",
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);
    output.push_str(&format!("# TYPE touhouflandre_multi_ws_connections gauge\ntouhouflandre_multi_ws_connections {}\n# TYPE touhouflandre_multi_active_rounds gauge\ntouhouflandre_multi_active_rounds {active}\n",state.realtime.connection_count()));
    output.push_str("# TYPE touhouflandre_multi_active_encounters gauge\n");
    if let Ok(rows)=sqlx::query_as::<_,(String,i32,i64)>("SELECT m.rule_set_key,m.rule_set_version,count(*)::bigint FROM multi_relay_encounter e JOIN multi_match m ON m.id=e.match_id WHERE m.status='playing' AND e.status<>'ended' GROUP BY m.rule_set_key,m.rule_set_version").fetch_all(&state.pool).await {for(key,version,count)in rows{output.push_str(&format!("touhouflandre_multi_active_encounters{} {count}\n",Labels::new("relay",&key,version).text(None)));}}
    output
}
