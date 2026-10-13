mod catalog_support;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use catalog_support::*;
use serde_json::{Value, json};
use touhouflandre_api::{contracts, router as server, seed};
use tower::ServiceExt;

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn catalog_routes_search_validation_and_cache_contract() {
    let db = Database::new().await;
    let app = db.app();
    assert_eq!(
        request(&app, "GET", "/api/catalog", None).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        request(&app, "GET", "/readyz", None).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    let version = db.seed().await;
    assert_eq!(
        request(&app, "GET", "/readyz", None).await.0,
        StatusCode::OK
    );
    let (status, _, full) = request(&app, "GET", "/api/catalog/full", None).await;
    assert_eq!(status, StatusCode::OK);
    contracts::validate_value("CatalogFull", &full).unwrap();
    assert_eq!(full["version"], version);
    assert!(
        full["characters"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["firstAppearance"].get("workPinyinInitials").is_none())
    );
    for (path, schema) in [
        ("/api/catalog", "CatalogSummary"),
        ("/api/catalog/characters", "CatalogCharacters"),
    ] {
        let (status, _, body) = request(&app, "GET", path, None).await;
        assert_eq!(status, StatusCode::OK);
        contracts::validate_value(schema, &body).unwrap();
    }
    for query in [
        "limit=0",
        "limit=251",
        "offset=-1",
        "sort=bad",
        "direction=sideways",
        "roomId=one",
        "sessionId=x&catalogVersion=y",
    ] {
        assert_eq!(
            request(
                &app,
                "GET",
                &format!("/api/characters/search?{query}"),
                None
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let (_, _, empty) = request(&app, "GET", "/api/characters/search?workIds=", None).await;
    assert_eq!(empty["total"], 0);
    let (status, _, found) = request(
        &app,
        "GET",
        "/api/characters/search?q=reimu&sort=relevance",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(found["total"].as_i64().unwrap() > 0);
    contracts::validate_value("CharacterSearchResponse", &found).unwrap();
    let (status, headers, policy) = request(&app, "GET", "/api/catalog/search-policy", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(policy["gameScopeMode"], "strict");
    let path = format!("/api/catalog/{version}/search-index/2");
    let (status, headers, index) = request(&app, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK);
    contracts::validate_value("CatalogSearchIndex", &index).unwrap();
    let etag = headers[header::ETAG].to_str().unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&path)
                .header(header::IF_NONE_MATCH, format!("\"other\", W/{etag}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(to_bytes(response.into_body(), 100).await.unwrap().len(), 0);
    let (status, headers, _) =
        request(&app, "GET", "/api/catalog/missing/search-index/2", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/catalog/{version}/search-index/1"),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/characters/search?q=query-secret")
                .header("x-character-search-fallback-reason", "room-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let metrics = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    for name in [
        "policy_total",
        "source_total",
        "snapshot_total",
        "fallback_reason_total",
        "remote_total",
        "index_build_seconds_count",
        "remote_latency_seconds_count",
    ] {
        assert!(
            metrics.contains(&format!("touhouflandre_search_{name}")),
            "missing {name}"
        );
    }
    assert!(metrics.contains("touhouflandre_search_fallback_reason_total{reason=\"unknown\"}"));
    assert!(!metrics.contains("query-secret") && !metrics.contains("room-secret"));
    let mut visits = vec![];
    for _ in 0..12 {
        let app = app.clone();
        visits.push(tokio::spawn(async move {
            request(&app, "POST", "/api/site/visits", None).await.2["count"]
                .as_i64()
                .unwrap()
        }));
    }
    let mut counts = vec![];
    for task in visits {
        counts.push(task.await.unwrap());
    }
    counts.sort();
    assert_eq!(counts, (1..=12).collect::<Vec<_>>());
    db.close().await;
}
async fn create(app: &axum::Router, scope: Option<Value>) -> Value {
    let body = scope.map(|scope| json!({"questionScope":scope}));
    let (status, _, body) = request(app, "POST", "/api/puzzles/random", body).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    contracts::validate_value("PuzzleResponse", &body).unwrap();
    body["session"].clone()
}
async fn answer(db: &Database, id: &str) -> String {
    sqlx::query_scalar("SELECT answer_id FROM game_session WHERE id=$1")
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}
#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn solo_guess_forfeit_legacy_hydration_and_frozen_catalog() {
    let db = Database::new().await;
    db.seed().await;
    let app = db.app();
    let session = create(&app, None).await;
    let id = session["id"].as_str().unwrap();
    assert_eq!(id.len(), 25);
    assert!(
        id.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    );
    assert!(session.get("answer").is_none());
    let answer = answer(&db, id).await;
    let (status, _, body) = request(
        &app,
        "POST",
        &format!("/api/sessions/{id}/guess"),
        Some(json!({"guessId":"missing"})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "INVALID_GUESS");
    let (status, _, won) = request(
        &app,
        "POST",
        &format!("/api/sessions/{id}/guess"),
        Some(json!({"guessId":answer,"expectedGuessCount":0})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(won["session"]["status"], "won");
    assert_eq!(won["session"]["answer"]["id"], answer);
    contracts::validate_value("PublicGameSession", &won["session"]).unwrap();
    sqlx::query("UPDATE game_session SET guesses=(SELECT jsonb_agg(value-'matchKind'-'guessAvatarUrl') FROM jsonb_array_elements(guesses)) WHERE id=$1").bind(id).execute(&db.pool).await.unwrap();
    let (_, _, resumed) = request(&app, "GET", &format!("/api/sessions/{id}"), None).await;
    assert_eq!(resumed["session"]["guesses"][0]["matchKind"], "exact");
    assert!(
        resumed["session"]["guesses"][0]["guessAvatarUrl"]
            .as_str()
            .unwrap()
            .starts_with("/characters/")
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/api/sessions/{id}/guess"),
            Some(json!({"guessId":answer}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let playing = create(&app, None).await;
    let playing_id = playing["id"].as_str().unwrap();
    let mut catalog = seed::load_catalog(&data_dir()).unwrap();
    let old_version = catalog.version.clone();
    for c in &mut catalog.characters {
        c.names.aliases.push("brandnewsearchterm".into());
    }
    catalog.version = seed::compute_version(&catalog.works, &catalog.characters).unwrap();
    seed::persist(&db.pool, &catalog).await.unwrap();
    let (_, _, current) = request(
        &app,
        "GET",
        "/api/characters/search?q=brandnewsearchterm",
        None,
    )
    .await;
    assert!(current["total"].as_i64().unwrap() > 0);
    let (_, _, frozen) = request(
        &app,
        "GET",
        &format!("/api/characters/search?q=brandnewsearchterm&sessionId={playing_id}"),
        None,
    )
    .await;
    assert_eq!(frozen["total"], 0);
    let (status, _, lost) = request(
        &app,
        "POST",
        &format!("/api/sessions/{playing_id}/forfeit"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(lost["session"]["status"], "lost");
    assert_eq!(lost["session"]["catalogVersion"], old_version);
    assert!(lost["session"].get("answer").is_some());
    db.close().await;
}
#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn resolve_idempotency_concurrency_resume_supersede_and_expiry() {
    let db = Database::new().await;
    db.seed().await;
    let app = db.app();
    let body = json!({"idempotencyKey":"same"});
    let mut tasks = vec![];
    for _ in 0..12 {
        let app = app.clone();
        let body = body.clone();
        tasks.push(tokio::spawn(async move {
            request(&app, "POST", "/api/puzzles/random/resolve", Some(body)).await
        }));
    }
    let mut ids = vec![];
    for task in tasks {
        let (status, _, result) = task.await.unwrap();
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["resolution"], "created");
        ids.push(result["session"]["id"].as_str().unwrap().to_owned());
    }
    assert!(ids.iter().all(|id| id == &ids[0]));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM game_session")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let (status, _, conflict) = request(
        &app,
        "POST",
        "/api/puzzles/random/resolve",
        Some(json!({"idempotencyKey":"same","resumeSessionId":ids[0]})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(conflict["code"], "IDEMPOTENCY_KEY_REUSED");
    request(
        &app,
        "POST",
        &format!("/api/sessions/{}/forfeit", ids[0]),
        None,
    )
    .await;
    let (status, _, resumed) = request(
        &app,
        "POST",
        "/api/puzzles/random/resolve",
        Some(json!({"idempotencyKey":"resume","resumeSessionId":format!(" {} ",ids[0])})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resumed["resolution"], "resumed");
    assert_eq!(resumed["session"]["status"], "lost");
    let (_, _, full) = request(&app, "GET", "/api/catalog/full", None).await;
    let mut scope = full["defaultQuestionScope"].clone();
    scope["rules"]["guessLimit"]["maxGuesses"] = json!(1);
    let (status, _, created) = request(
        &app,
        "POST",
        "/api/puzzles/random/resolve",
        Some(json!({"idempotencyKey":"different","resumeSessionId":ids[0],"questionScope":scope})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["resolution"], "created");
    assert_eq!(created["supersededSession"]["id"], ids[0]);
    assert_eq!(created["session"]["maxGuesses"], 1);
    sqlx::query("UPDATE puzzle_resolve_idempotency SET expires_at=now()-interval '1 second' WHERE idempotency_key='same'").execute(&db.pool).await.unwrap();
    let (status, _, reused) = request(
        &app,
        "POST",
        "/api/puzzles/random/resolve",
        Some(json!({"idempotencyKey":"same","resumeSessionId":ids[0]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reused["resolution"], "resumed");
    db.close().await;
}
#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn timeout_and_guess_race_consumes_one_turn() {
    let db = Database::new().await;
    db.seed().await;
    let app = db.app();
    let (_, _, full) = request(&app, "GET", "/api/catalog/full", None).await;
    let mut scope = full["defaultQuestionScope"].clone();
    scope["rules"]["turnLimit"] = json!({"enabled":true,"seconds":30});
    scope["rules"]["guessLimit"] = json!({"enabled":true,"maxGuesses":2});
    let session = create(&app, Some(scope)).await;
    let id = session["id"].as_str().unwrap();
    let answer = answer(&db, id).await;
    let guess_path = format!("/api/sessions/{id}/guess");
    let timeout_path = format!("/api/sessions/{id}/timeout");
    let (g, t) = tokio::join!(
        request(
            &app,
            "POST",
            &guess_path,
            Some(json!({"guessId":answer,"expectedGuessCount":0}))
        ),
        request(
            &app,
            "POST",
            &timeout_path,
            Some(json!({"expectedGuessCount":0}))
        )
    );
    assert!(g.0 == StatusCode::OK || g.0 == StatusCode::CONFLICT);
    assert_eq!(t.0, StatusCode::OK);
    let (_, _, current) = request(&app, "GET", &format!("/api/sessions/{id}"), None).await;
    assert_eq!(current["session"]["guesses"].as_array().unwrap().len(), 1);
    let (_, _, stale) = request(
        &app,
        "POST",
        &timeout_path,
        Some(json!({"expectedGuessCount":0})),
    )
    .await;
    assert_eq!(stale["session"]["guesses"].as_array().unwrap().len(), 1);
    let plain = create(&app, None).await;
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/api/sessions/{}/timeout", plain["id"].as_str().unwrap()),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    db.close().await;
}
#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn daily_uses_shanghai_date_frozen_policy_catalog_and_eight_guesses() {
    let db = Database::new().await;
    db.seed().await;
    let mut state = db.state();
    state.clock = std::sync::Arc::new(|| {
        chrono::DateTime::parse_from_rfc3339("2026-08-02T16:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
    });
    let app = server::router(state.clone()).unwrap();
    let (status, _, first) = request(
        &app,
        "POST",
        "/api/puzzles/daily",
        Some(json!({"difficulty":"easy"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["session"]["puzzleKey"], "2026-08-03");
    assert_eq!(first["session"]["maxGuesses"], 8);
    assert_eq!(
        first["session"]["questionScope"]["rules"]["guessLimit"]["enabled"],
        false
    );
    let first_answer = answer(&db, first["session"]["id"].as_str().unwrap()).await;
    let mut catalog = seed::load_catalog(&data_dir()).unwrap();
    catalog.characters[0]
        .names
        .aliases
        .push("new-version".into());
    catalog.version = seed::compute_version(&catalog.works, &catalog.characters).unwrap();
    seed::persist(&db.pool, &catalog).await.unwrap();
    let mut config = (*state.config).clone();
    config.answer_match_policy = "strict".into();
    state.config = std::sync::Arc::new(config);
    let app = server::router(state).unwrap();
    let (_, _, second) = request(
        &app,
        "POST",
        "/api/puzzles/daily",
        Some(json!({"difficulty":"easy"})),
    )
    .await;
    assert_eq!(
        second["session"]["catalogVersion"],
        first["session"]["catalogVersion"]
    );
    assert_eq!(
        answer(&db, second["session"]["id"].as_str().unwrap()).await,
        first_answer
    );
    let policy: String =
        sqlx::query_scalar("SELECT answer_match_policy FROM game_session WHERE id=$1")
            .bind(second["session"]["id"].as_str())
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(policy, "public_fields_v1");
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/puzzles/daily",
            Some(json!({"difficulty":"extra"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    db.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn resolve_fingerprints_match_the_original_go_persistent_records() {
    // Captured independently using Go encoding/json and the original game
    // structs, including sorted map keys, HTML escaping and legacy rule fields.
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/solo-fingerprints.json")).unwrap();
    let db = Database::new().await;
    db.seed().await;
    let app = db.app();
    for case in cases {
        contracts::validate_value("PuzzleResolveRequest", &case["body"]).unwrap();
        let body = case["body"].clone();
        let key = body["idempotencyKey"].as_str().unwrap().trim().to_owned();
        let path = format!("/api/puzzles/{}/resolve", case["mode"].as_str().unwrap());
        let (status, _, result) = request(&app, "POST", &path, Some(body.clone())).await;
        assert_eq!(status, StatusCode::OK, "{}: {result}", case["name"]);
        let actual: String = sqlx::query_scalar(
            "SELECT request_fingerprint FROM puzzle_resolve_idempotency WHERE idempotency_key=$1",
        )
        .bind(&key)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(
            actual,
            case["expected"].as_str().unwrap(),
            "{}",
            case["name"]
        );
        // Install the independently captured fingerprint, then prove replay
        // recovers the existing session instead of creating or rejecting it.
        sqlx::query(
            "UPDATE puzzle_resolve_idempotency SET request_fingerprint=$2 WHERE idempotency_key=$1",
        )
        .bind(&key)
        .bind(case["expected"].as_str().unwrap())
        .execute(&db.pool)
        .await
        .unwrap();
        let (status, _, replay) = request(&app, "POST", &path, Some(body)).await;
        assert_eq!(status, StatusCode::OK, "{replay}");
        assert_eq!(replay["session"]["id"], result["session"]["id"]);
    }
    db.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn legacy_null_guesses_and_empty_hair_index_projection_remain_compatible() {
    let db = Database::new().await;
    let mut data = seed::load_catalog(&data_dir()).unwrap();
    data.characters[0].hair_colors.clear();
    data.version = seed::compute_version(&data.works, &data.characters).unwrap();
    seed::persist(&db.pool, &data).await.unwrap();
    let app = db.app();
    let (status, headers, index) = request(
        &app,
        "GET",
        &format!("/api/catalog/{}/search-index/2", data.version),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(index["entries"][0]["hairColors"], json!([]));
    let expected =
        touhouflandre_api::game::build_catalog_search_snapshot(&data.version, 2, &data.characters)
            .unwrap();
    assert_eq!(headers[header::ETAG].to_str().unwrap(), expected.etag);
    let session = create(&app, None).await;
    let id = session["id"].as_str().unwrap();
    sqlx::query("UPDATE game_session SET guesses='null'::jsonb WHERE id=$1")
        .bind(id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _, restored) = request(&app, "GET", &format!("/api/sessions/{id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(restored["session"]["guesses"], json!([]));
    let (status, _, ended) =
        request(&app, "POST", &format!("/api/sessions/{id}/forfeit"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ended["session"]["status"], "lost");
    db.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn daily_and_random_empty_pools_and_missing_answer_keep_error_contracts() {
    let db = Database::new().await;
    let mut data = seed::load_catalog(&data_dir()).unwrap();
    seed::persist(&db.pool, &data).await.unwrap();
    let app = db.app();
    let (status, _, _) = request(&app, "POST", "/api/puzzles/daily", None).await;
    assert_eq!(status, StatusCode::OK);
    sqlx::query("UPDATE daily_puzzle SET answer_id='missing-answer'")
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, _, result) = request(&app, "POST", "/api/puzzles/daily", None).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(result["error"], "每日题快照中缺少答案角色。");
    sqlx::query("DELETE FROM daily_puzzle")
        .execute(&db.pool)
        .await
        .unwrap();
    for character in &mut data.characters {
        character.enabled_as_answer = false;
    }
    data.version = seed::compute_version(&data.works, &data.characters).unwrap();
    seed::persist(&db.pool, &data).await.unwrap();
    for (mode, message) in [
        ("daily", "daily puzzle requires at least one enabled answer"),
        ("random", "题库中没有可作为答案的角色。"),
    ] {
        let (status, _, result) =
            request(&app, "POST", &format!("/api/puzzles/{mode}"), None).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(result["code"], "INTERNAL");
        assert_eq!(result["error"], message);
    }
    db.close().await;
}
