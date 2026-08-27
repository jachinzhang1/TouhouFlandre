package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

func TestMRX007FixedPointsCompletesExactPlannedStages(t *testing.T) {
	formats := []struct {
		name   string
		stages int
	}{{"bo1", 1}, {"bo3", 3}, {"bo5", 5}, {"bo7", 7}}
	for _, playerCount := range []int{4, 6, 8} {
		for _, format := range formats {
			t.Run(fmt.Sprintf("players-%d-%s", playerCount, format.name), func(t *testing.T) {
				fixture := createMRX007Fixture(t, playerCount, format.name, format.stages)
				coordinator := newMRX007Coordinator(t)
				created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
					Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
				})
				if err != nil {
					t.Fatal(err)
				}
				plan := created.Plan
				for stageIndex := 1; stageIndex <= format.stages; stageIndex++ {
					if plan.StageIndex != stageIndex {
						t.Fatalf("stage index = %d, want %d", plan.StageIndex, stageIndex)
					}
					endMRX007Encounters(t, plan, false)
					settled, err := coordinator.TrySettle(ctx, plan.StageID)
					if err != nil {
						t.Fatal(err)
					}
					if !settled.Owner {
						t.Fatalf("stage %d settlement = %+v", stageIndex, settled)
					}
					if stageIndex < format.stages {
						if settled.NextStage == nil {
							t.Fatalf("stage %d ended early", stageIndex)
						}
						plan = *settled.NextStage
					} else if settled.NextStage != nil {
						t.Fatalf("terminal stage created another stage: %+v", settled.NextStage)
					}
				}

				var stages, settlements, stageEndedEvents, matchEndedEvents, legacyScoresChanged int
				var status string
				if err := pool.QueryRow(ctx, `
					SELECT
						(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $1),
						(SELECT count(*)::int FROM multi_relay_stage_player WHERE match_id = $1),
						(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.stage.ended'),
						(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'match.ended'),
						(SELECT count(*)::int FROM multi_match_player WHERE match_id = $1 AND (wins <> 0 OR score <> 0)),
						(SELECT status FROM multi_match WHERE id = $1)`, fixture.match.MatchID, fixture.roomID).
					Scan(&stages, &settlements, &stageEndedEvents, &matchEndedEvents, &legacyScoresChanged, &status); err != nil {
					t.Fatal(err)
				}
				if stages != format.stages || settlements != playerCount*format.stages || stageEndedEvents != format.stages || matchEndedEvents != 1 || legacyScoresChanged != 0 || status != "finished" {
					t.Fatalf("stages=%d settlements=%d stageEvents=%d matchEvents=%d legacyChanged=%d status=%s",
						stages, settlements, stageEndedEvents, matchEndedEvents, legacyScoresChanged, status)
				}
			})
		}
	}
}

func TestMRX007BarrierPublishesScoresOnlyAfterLastEncounter(t *testing.T) {
	fixture := createMRX007Fixture(t, 4, "bo1", 1)
	coordinator := newMRX007Coordinator(t)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	endMRX007Encounter(t, created.Plan.Encounters[0], false)
	result, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Ready {
		t.Fatalf("barrier settled before the final encounter: %+v", result)
	}
	assertMRX007PublicSettlement(t, fixture, created.Plan.StageID, 0, 0, 0)

	endMRX007Encounter(t, created.Plan.Encounters[1], false)
	result, err = coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Owner {
		t.Fatalf("final encounter did not own settlement: %+v", result)
	}
	assertMRX007PublicSettlement(t, fixture, created.Plan.StageID, 4, 4, 1)
}

func TestMRX007ProductionRuntimeResumesFrozenFixedPointsMatch(t *testing.T) {
	fixture := createMRX007Fixture(t, 4, "bo3", 3)
	clock := &mrx006Clock{value: time.Now().UTC()}
	timing := multi.DefaultTimingConfig()
	timing.Intermission = 0
	coordinator, _, err := relayadapter.NewRuntime(pool, clock, mrx005Random{}, timing)
	if err != nil {
		t.Fatal(err)
	}
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: clock.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	endMRX007Encounters(t, created.Plan, false)
	settled, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if !settled.Owner || settled.NextStage == nil || settled.NextStage.StageIndex != 2 || len(settled.NextStage.Encounters) != 2 {
		t.Fatalf("production runtime settlement = %+v", settled)
	}
	if settled.NextStage.Match.RuleSet != relay.FixedPointsRuleSet() {
		t.Fatalf("next stage rule set = %s", settled.NextStage.Match.RuleSet)
	}
	if settled.NextStage.Encounters[0].AnswerID == settled.NextStage.Encounters[1].AnswerID {
		t.Fatalf("production provisioner reused an answer in one stage")
	}
}

func TestMRX007ConcurrentRetriesSettleExactlyOnce(t *testing.T) {
	fixture := createMRX007Fixture(t, 8, "bo1", 1)
	coordinator := newMRX007Coordinator(t)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	endMRX007Encounters(t, created.Plan, false)

	start := make(chan struct{})
	results := make(chan relay.SettlementResult, 8)
	errorsCh := make(chan error, 8)
	var wg sync.WaitGroup
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := coordinator.TrySettle(ctx, created.Plan.StageID)
			if err != nil {
				errorsCh <- err
				return
			}
			results <- result
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	owners := 0
	for result := range results {
		if result.Owner {
			owners++
		}
	}
	if owners != 1 {
		t.Fatalf("settlement owners = %d", owners)
	}
	assertMRX007PublicSettlement(t, fixture, created.Plan.StageID, 8, 8, 1)
	var stages, matchEnded int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'match.ended')`,
		fixture.match.MatchID, fixture.roomID).Scan(&stages, &matchEnded); err != nil {
		t.Fatal(err)
	}
	if stages != 1 || matchEnded != 1 {
		t.Fatalf("stages=%d matchEnded=%d", stages, matchEnded)
	}
}

func TestMRX007RankingSnapshotAndReplayAgree(t *testing.T) {
	tests := []struct {
		name      string
		draw      bool
		wantRanks []int
	}{{name: "all-draw", draw: true, wantRanks: []int{1, 1, 1, 1}}, {name: "partial-ties", wantRanks: []int{1, 1, 3, 3}}}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := createMRX007Fixture(t, 4, "bo1", 1)
			coordinator := newMRX007Coordinator(t)
			created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
				Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
			})
			if err != nil {
				t.Fatal(err)
			}
			replaceMRX007AnswersWithCatalog(t, created.Plan)
			endMRX007Encounters(t, created.Plan, test.draw)
			if result, err := coordinator.TrySettle(ctx, created.Plan.StageID); err != nil || !result.Owner {
				t.Fatalf("settlement=%+v error=%v", result, err)
			}

			token := "mrx007-" + multi.NewID()
			if _, err := pool.Exec(ctx, `UPDATE multi_member SET token_hash = $1 WHERE id = $2`, multi.HashToken(token), fixture.players[0].MemberID); err != nil {
				t.Fatal(err)
			}
			response, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot?after=0", token, nil)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("snapshot: %d %s", response.StatusCode, payload)
			}
			var snapshot openapi.RoomSnapshot
			if err := json.Unmarshal(payload, &snapshot); err != nil {
				t.Fatal(err)
			}
			if snapshot.Match == nil || snapshot.Match.Relay == nil || snapshot.Match.Relay.PlannedStages == nil || *snapshot.Match.Relay.PlannedStages != 1 || snapshot.Match.Relay.Ranking == nil {
				t.Fatalf("relay snapshot = %+v", snapshot.Match)
			}
			snapshotRanks := make([]int, 0, len(*snapshot.Match.Relay.Ranking))
			for _, entry := range *snapshot.Match.Relay.Ranking {
				snapshotRanks = append(snapshotRanks, entry.Rank)
			}
			sort.Ints(snapshotRanks)
			if fmt.Sprint(snapshotRanks) != fmt.Sprint(test.wantRanks) {
				t.Fatalf("snapshot ranks=%v want=%v", snapshotRanks, test.wantRanks)
			}

			var wire struct {
				Events []struct {
					Type    string          `json:"type"`
					Payload json.RawMessage `json:"payload"`
				} `json:"events"`
			}
			if err := json.Unmarshal(payload, &wire); err != nil {
				t.Fatal(err)
			}
			var replayStage multi.RelayStageEndedPayload
			var replayMatch multi.MatchEndedPayload
			for _, event := range wire.Events {
				switch event.Type {
				case string(multi.EventRelayStageEnded):
					if err := json.Unmarshal(event.Payload, &replayStage); err != nil {
						t.Fatal(err)
					}
				case string(multi.EventMatchEnded):
					if err := json.Unmarshal(event.Payload, &replayMatch); err != nil {
						t.Fatal(err)
					}
				}
			}
			if len(replayStage.Settlement) != 4 || len(replayMatch.Ranking) != 4 || replayMatch.WinnerMemberID != nil {
				t.Fatalf("stage=%+v match=%+v", replayStage, replayMatch)
			}
			assertMRX007SettlementMatchesDatabase(t, created.Plan.StageID, replayStage.Settlement)
			for index, entry := range replayMatch.Ranking {
				if entry.MemberID != (*snapshot.Match.Relay.Ranking)[index].MemberId || entry.Rank != (*snapshot.Match.Relay.Ranking)[index].Rank || entry.Score != (*snapshot.Match.Relay.Ranking)[index].Score {
					t.Fatalf("replay ranking[%d]=%+v snapshot=%+v", index, entry, (*snapshot.Match.Relay.Ranking)[index])
				}
			}
		})
	}
}

func createMRX007Fixture(t *testing.T, playerCount int, format string, plannedStages int) mrx005Fixture {
	t.Helper()
	fixture := createMRX005Fixture(t, playerCount)
	if _, err := pool.Exec(ctx, `UPDATE multi_room SET format = $2 WHERE id = $1`, fixture.roomID, format); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE multi_match SET max_rounds = $2, target_wins = 1 WHERE id = $1`, fixture.match.MatchID, plannedStages); err != nil {
		t.Fatal(err)
	}
	fixture.match.RuleSet = relay.FixedPointsRuleSet()
	fixture.match.TargetWins = 1
	fixture.match.MaxStages = plannedStages
	return fixture
}

func newMRX007Coordinator(t *testing.T) *relay.StageCoordinator {
	t.Helper()
	coordinator, err := relay.NewStageCoordinator(
		relayadapter.NewStageRepository(pool), relay.RandomPairingPolicy{}, mrx005Provisioner{}, relay.FixedPointsPolicy{},
		mrx005Clock{value: time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)}, mrx005Random{},
		&mrx005IDs{prefix: "mrx007-" + multi.NewID()}, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	return coordinator
}

func endMRX007Encounters(t *testing.T, plan relay.StagePlan, draw bool) {
	t.Helper()
	for _, encounter := range plan.Encounters {
		endMRX007Encounter(t, encounter, draw)
	}
}

func endMRX007Encounter(t *testing.T, encounter relay.EncounterPlan, draw bool) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if draw {
		if _, err := tx.Exec(ctx, `
			UPDATE multi_relay_encounter
			SET status = 'ended', winner_member_id = NULL, outcome = 'draw', ended_at = clock_timestamp(),
			    turn_member_id = NULL, turn_deadline = NULL
			WHERE id = $1 AND status <> 'ended'`, encounter.EncounterID); err != nil {
			t.Fatal(err)
		}
	} else {
		if _, err := tx.Exec(ctx, `
			UPDATE multi_relay_encounter
			SET status = 'ended', winner_member_id = $2, outcome = 'win', ended_at = clock_timestamp(),
			    turn_member_id = NULL, turn_deadline = NULL
			WHERE id = $1 AND status <> 'ended'`, encounter.EncounterID, encounter.Members[0].MemberID); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func assertMRX007PublicSettlement(t *testing.T, fixture mrx005Fixture, stageID string, wantScoreSum, wantSettlements, wantStageEvents int) {
	t.Helper()
	var scoreSum, settlements, stageEvents int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT coalesce(sum(score), 0)::int FROM multi_relay_match_player_state WHERE match_id = $1),
			(SELECT count(*)::int FROM multi_relay_stage_player WHERE stage_id = $2),
			(SELECT count(*)::int FROM room_event WHERE room_id = $3 AND type = 'relay.stage.ended')`,
		fixture.match.MatchID, stageID, fixture.roomID).Scan(&scoreSum, &settlements, &stageEvents); err != nil {
		t.Fatal(err)
	}
	if scoreSum != wantScoreSum || settlements != wantSettlements || stageEvents != wantStageEvents {
		t.Fatalf("scoreSum=%d settlements=%d stageEvents=%d", scoreSum, settlements, stageEvents)
	}
}

func replaceMRX007AnswersWithCatalog(t *testing.T, plan relay.StagePlan) {
	t.Helper()
	var catalogVersion string
	if err := pool.QueryRow(ctx, `SELECT catalog_version FROM multi_match WHERE id = $1`, plan.Match.MatchID).Scan(&catalogVersion); err != nil {
		t.Fatal(err)
	}
	characters, err := multi.CharactersForVersion(ctx, repo.New(pool), catalogVersion)
	if err != nil {
		t.Fatal(err)
	}
	if len(characters) < len(plan.Encounters) {
		t.Fatalf("catalog contains %d characters for %d encounters", len(characters), len(plan.Encounters))
	}
	for index, encounter := range plan.Encounters {
		if _, err := pool.Exec(ctx, `UPDATE multi_relay_encounter SET answer_id = $2 WHERE id = $1`, encounter.EncounterID, characters[index].ID); err != nil {
			t.Fatal(err)
		}
	}
}

func assertMRX007SettlementMatchesDatabase(t *testing.T, stageID string, event []multi.RelayStageSettlementView) {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT member_id, score_before, score_delta, score_after
		FROM multi_relay_stage_player WHERE stage_id = $1 ORDER BY member_id`, stageID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	eventByMember := make(map[string]multi.RelayStageSettlementView, len(event))
	for _, entry := range event {
		eventByMember[entry.MemberID] = entry
	}
	count := 0
	for rows.Next() {
		var memberID string
		var before, delta, after int
		if err := rows.Scan(&memberID, &before, &delta, &after); err != nil {
			t.Fatal(err)
		}
		entry, ok := eventByMember[memberID]
		if !ok || entry.ScoreBefore != before || entry.ScoreDelta != delta || entry.ScoreAfter != after {
			t.Fatalf("database %s=%d/%d/%d event=%+v", memberID, before, delta, after, entry)
		}
		count++
	}
	if err := rows.Err(); err != nil && err != pgx.ErrNoRows {
		t.Fatal(err)
	}
	if count != len(event) {
		t.Fatalf("database rows=%d event rows=%d", count, len(event))
	}
}
