package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

func TestMRX008ProductionRuntimePersistsEliminationAndCreatesOddBye(t *testing.T) {
	fixture := createMRX008Fixture(t, 4)
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
	firstLoser := created.Plan.Encounters[0].Members[1]
	secondLoser := created.Plan.Encounters[1].Members[1]
	setMRX008PlayerState(t, fixture, firstLoser.MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	setMRX008PlayerState(t, fixture, secondLoser.MemberID, 1, relay.LifeStateHealthy, "active", nil)
	endMRX007Encounters(t, created.Plan, false)

	result, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Owner || result.NextStage == nil || len(result.NextStage.Encounters) != 1 || result.NextStage.Bye == nil {
		t.Fatalf("settlement = %+v", result)
	}
	if stageContainsMember(*result.NextStage, firstLoser.MemberID) {
		t.Fatalf("eliminated member %s appears in next stage", firstLoser.MemberID)
	}

	var score, eliminatedStage int
	var life, status string
	if err := pool.QueryRow(ctx, `
		SELECT state.score, state.life_state, state.eliminated_stage, roster.status
		FROM multi_relay_match_player_state AS state
		JOIN multi_match_player AS roster USING (match_id, member_id)
		WHERE state.match_id = $1 AND state.member_id = $2`, fixture.match.MatchID, firstLoser.MemberID).
		Scan(&score, &life, &eliminatedStage, &status); err != nil {
		t.Fatal(err)
	}
	if score != -1 || life != string(relay.LifeStateNearDeath) || eliminatedStage != 1 || status != "eliminated" {
		t.Fatalf("eliminated state score=%d life=%s stage=%d status=%s", score, life, eliminatedStage, status)
	}
	var exactZeroLife, exactZeroStatus string
	var exactZeroScore int
	if err := pool.QueryRow(ctx, `
		SELECT state.score, state.life_state, roster.status
		FROM multi_relay_match_player_state AS state
		JOIN multi_match_player AS roster USING (match_id, member_id)
		WHERE state.match_id = $1 AND state.member_id = $2`, fixture.match.MatchID, secondLoser.MemberID).
		Scan(&exactZeroScore, &exactZeroLife, &exactZeroStatus); err != nil {
		t.Fatal(err)
	}
	if exactZeroScore != 0 || exactZeroLife != string(relay.LifeStateHealthy) || exactZeroStatus != "active" {
		t.Fatalf("exact-zero state score=%d life=%s status=%s", exactZeroScore, exactZeroLife, exactZeroStatus)
	}

	stageEvent := loadMRX008StageEndedEvent(t, fixture.roomID, 1)
	if len(stageEvent.EliminatedMemberIDs) != 1 || stageEvent.EliminatedMemberIDs[0] != firstLoser.MemberID || stageEvent.ByeMemberID != nil {
		t.Fatalf("stage event = %+v", stageEvent)
	}
	byMember := mrx008SettlementByMember(stageEvent.Settlement)
	if byMember[firstLoser.MemberID].LifeTransition != multi.RelayLifeTransitionEliminated || byMember[secondLoser.MemberID].LifeTransition != multi.RelayLifeTransitionNone {
		t.Fatalf("settlement = %+v", stageEvent.Settlement)
	}

	snapshot := loadMRX008Snapshot(t, fixture, fixture.players[0].MemberID)
	if snapshot.Match == nil || snapshot.Match.Relay == nil || snapshot.Match.Relay.PlannedStages != nil {
		t.Fatalf("relay snapshot = %+v", snapshot.Match)
	}
	foundEliminated := false
	for _, standing := range snapshot.Match.Relay.Standings {
		if standing.MemberId == firstLoser.MemberID {
			foundEliminated = standing.Score == -1 && standing.Status == openapi.MatchPlayerStatusEliminated && standing.EliminatedStage != nil && *standing.EliminatedStage == 1
		}
	}
	if !foundEliminated {
		t.Fatalf("snapshot standings = %+v", snapshot.Match.Relay.Standings)
	}
}

func TestMRX008ByeIsFrozenAndSettlementRetryIsIdempotent(t *testing.T) {
	fixture := createMRX008Fixture(t, 4)
	coordinator := newMRX008Coordinator(t)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	firstLoser := created.Plan.Encounters[0].Members[1]
	setMRX008PlayerState(t, fixture, firstLoser.MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	endMRX007Encounters(t, created.Plan, false)
	first, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil || first.NextStage == nil || first.NextStage.Bye == nil {
		t.Fatalf("first settlement=%+v error=%v", first, err)
	}
	secondPlan := *first.NextStage
	currentBye := *secondPlan.Bye
	setMRX008PlayerState(t, fixture, currentBye.MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	for _, encounter := range secondPlan.Encounters {
		for _, player := range encounter.Members {
			setMRX008PlayerState(t, fixture, player.MemberID, 10, relay.LifeStateHealthy, "active", nil)
		}
	}
	endMRX007Encounters(t, secondPlan, false)
	settled, err := coordinator.TrySettle(ctx, secondPlan.StageID)
	if err != nil || !settled.Owner || settled.NextStage == nil || settled.NextStage.Bye == nil {
		t.Fatalf("second settlement=%+v error=%v", settled, err)
	}
	if settled.NextStage.Bye.MemberID == currentBye.MemberID {
		t.Fatalf("member %s received consecutive byes", currentBye.MemberID)
	}
	stableNextStage := settled.NextStage.StageID
	retried, err := coordinator.TrySettle(ctx, secondPlan.StageID)
	if err != nil || !retried.AlreadySettled || retried.NextStage == nil || retried.NextStage.StageID != stableNextStage {
		t.Fatalf("retry=%+v error=%v", retried, err)
	}

	var before, delta, after int
	var lifeBefore, lifeAfter string
	if err := pool.QueryRow(ctx, `
		SELECT score_before, score_delta, score_after, life_before, life_after
		FROM multi_relay_stage_player
		WHERE stage_id = $1 AND member_id = $2`, secondPlan.StageID, currentBye.MemberID).
		Scan(&before, &delta, &after, &lifeBefore, &lifeAfter); err != nil {
		t.Fatal(err)
	}
	if before != 0 || delta != 0 || after != 0 || lifeBefore != string(relay.LifeStateNearDeath) || lifeAfter != string(relay.LifeStateNearDeath) {
		t.Fatalf("bye settlement=%d/%d/%d %s/%s", before, delta, after, lifeBefore, lifeAfter)
	}
	stageEvent := loadMRX008StageEndedEvent(t, fixture.roomID, 2)
	if stageEvent.ByeMemberID == nil || *stageEvent.ByeMemberID != currentBye.MemberID || len(stageEvent.EliminatedMemberIDs) != 0 {
		t.Fatalf("stage event = %+v", stageEvent)
	}
	if mrx008SettlementByMember(stageEvent.Settlement)[currentBye.MemberID].LifeTransition != multi.RelayLifeTransitionNone {
		t.Fatalf("bye transition = %+v", stageEvent.Settlement)
	}
	var stagePlayers, stageEvents, stages int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_stage_player WHERE stage_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.stage.ended' AND payload->>'stageIndex' = '2'),
			(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $3)`, secondPlan.StageID, fixture.roomID, fixture.match.MatchID).
		Scan(&stagePlayers, &stageEvents, &stages); err != nil {
		t.Fatal(err)
	}
	if stagePlayers != 3 || stageEvents != 1 || stages != 3 {
		t.Fatalf("stagePlayers=%d stageEvents=%d stages=%d", stagePlayers, stageEvents, stages)
	}
}

func TestMRX008UniqueSurvivorEndsMatchAfterReductionToTwo(t *testing.T) {
	fixture := createMRX008Fixture(t, 4)
	coordinator := newMRX008Coordinator(t)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	firstWinner := created.Plan.Encounters[0].Members[0]
	secondWinner := created.Plan.Encounters[1].Members[0]
	setMRX008PlayerState(t, fixture, firstWinner.MemberID, 10, relay.LifeStateHealthy, "active", nil)
	setMRX008PlayerState(t, fixture, created.Plan.Encounters[0].Members[1].MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	setMRX008PlayerState(t, fixture, secondWinner.MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	setMRX008PlayerState(t, fixture, created.Plan.Encounters[1].Members[1].MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	endMRX007Encounters(t, created.Plan, false)
	first, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil || first.NextStage == nil || len(first.NextStage.Encounters) != 1 || first.NextStage.Bye != nil {
		t.Fatalf("first settlement=%+v error=%v", first, err)
	}
	secondPlan := *first.NextStage
	endMRX008Encounter(t, secondPlan.Encounters[0], firstWinner.MemberID, false)
	terminal, err := coordinator.TrySettle(ctx, secondPlan.StageID)
	if err != nil || !terminal.Owner || terminal.NextStage != nil {
		t.Fatalf("terminal=%+v error=%v", terminal, err)
	}
	var winner *string
	var status string
	if err := pool.QueryRow(ctx, `SELECT winner_member_id, status FROM multi_match WHERE id = $1`, fixture.match.MatchID).Scan(&winner, &status); err != nil {
		t.Fatal(err)
	}
	if winner == nil || *winner != firstWinner.MemberID || status != "finished" {
		t.Fatalf("winner=%v status=%s", winner, status)
	}
	ended := loadMRX008MatchEndedEvent(t, fixture.roomID)
	if ended.Relay == nil || ended.WinnerMemberID == nil || *ended.WinnerMemberID != firstWinner.MemberID || len(ended.Relay.Ranking) != 4 {
		t.Fatalf("match ended = %+v", ended)
	}
	if ended.Relay.Ranking[0].MemberID != firstWinner.MemberID || ended.Relay.Ranking[0].Rank != 1 || ended.Relay.Ranking[0].SurvivedStages == nil || *ended.Relay.Ranking[0].SurvivedStages != 2 {
		t.Fatalf("ranking = %+v", ended.Relay.Ranking)
	}
}

func TestMRX008ConcurrentFinalAllEliminationSettlesOnceWithoutWinner(t *testing.T) {
	fixture := createMRX008Fixture(t, 4)
	coordinator := newMRX008Coordinator(t)
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	replaceMRX007AnswersWithCatalog(t, created.Plan)
	for _, player := range fixture.players {
		setMRX008PlayerState(t, fixture, player.MemberID, 0, relay.LifeStateNearDeath, "active", nil)
	}
	endMRX007Encounters(t, created.Plan, false)
	first, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil || first.NextStage == nil || len(first.NextStage.Encounters) != 1 {
		t.Fatalf("first settlement=%+v error=%v", first, err)
	}
	secondPlan := *first.NextStage
	replaceMRX007AnswersWithCatalog(t, secondPlan)
	endMRX008Encounter(t, secondPlan.Encounters[0], "", true)

	start := make(chan struct{})
	results := make(chan relay.SettlementResult, 8)
	errorsCh := make(chan error, 8)
	var wg sync.WaitGroup
	for index := 0; index < 8; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := coordinator.TrySettle(ctx, secondPlan.StageID)
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

	ended := loadMRX008MatchEndedEvent(t, fixture.roomID)
	if ended.WinnerMemberID != nil || ended.Relay == nil || len(ended.Relay.Ranking) != 4 || len(ended.Ranking) != 0 {
		t.Fatalf("match ended = %+v", ended)
	}
	topCount := 0
	for _, entry := range ended.Relay.Ranking {
		if entry.Rank == 1 {
			topCount++
			if entry.SurvivedStages == nil || *entry.SurvivedStages != 1 {
				t.Fatalf("top ranking = %+v", entry)
			}
		}
	}
	if topCount != 2 {
		t.Fatalf("ranking = %+v", ended.Relay.Ranking)
	}
	var stages, stageEvents, matchEvents, eliminated int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.stage.ended'),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'match.ended'),
			(SELECT count(*)::int FROM multi_match_player WHERE match_id = $1 AND status = 'eliminated')`, fixture.match.MatchID, fixture.roomID).
		Scan(&stages, &stageEvents, &matchEvents, &eliminated); err != nil {
		t.Fatal(err)
	}
	if stages != 2 || stageEvents != 2 || matchEvents != 1 || eliminated != 4 {
		t.Fatalf("stages=%d stageEvents=%d matchEvents=%d eliminated=%d", stages, stageEvents, matchEvents, eliminated)
	}
	snapshot := loadMRX008Snapshot(t, fixture, fixture.players[0].MemberID)
	if snapshot.Match == nil || snapshot.Match.Relay == nil || snapshot.Match.Relay.Ranking == nil || len(*snapshot.Match.Relay.Ranking) != 4 {
		t.Fatalf("snapshot = %+v", snapshot.Match)
	}
}

func createMRX008Fixture(t *testing.T, playerCount int) mrx005Fixture {
	t.Helper()
	fixture := createMRX005Fixture(t, playerCount)
	if _, err := pool.Exec(ctx, `
		UPDATE multi_match
		SET rule_set_key = 'elimination', rule_set_version = 1, max_rounds = 1,
		    rule_config_snapshot = '{"mode":"relay","ruleSetKey":"elimination","ruleSetVersion":1}'::jsonb
		WHERE id = $1`, fixture.match.MatchID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_match_player_state
		SET score = 10, life_state = 'healthy', eliminated_stage = NULL
		WHERE match_id = $1`, fixture.match.MatchID); err != nil {
		t.Fatal(err)
	}
	fixture.match.RuleSet = relay.EliminationRuleSet()
	fixture.match.MaxStages = 1
	return fixture
}

func newMRX008Coordinator(t *testing.T) *relay.StageCoordinator {
	t.Helper()
	coordinator, err := relay.NewStageCoordinator(
		relayadapter.NewStageRepository(pool), relay.RandomPairingPolicy{}, mrx005Provisioner{}, relay.EliminationPolicy{},
		mrx005Clock{value: time.Date(2026, 8, 24, 16, 0, 0, 0, time.UTC)}, mrx005Random{},
		&mrx005IDs{prefix: "mrx008-" + multi.NewID()}, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	return coordinator
}

func setMRX008PlayerState(t *testing.T, fixture mrx005Fixture, memberID string, score int, life relay.LifeState, status string, eliminatedStage *int) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_match_player_state
		SET score = $3, life_state = $4, eliminated_stage = $5
		WHERE match_id = $1 AND member_id = $2`, fixture.match.MatchID, memberID, score, string(life), eliminatedStage); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_match_player SET status = $3
		WHERE match_id = $1 AND member_id = $2`, fixture.match.MatchID, memberID, status); err != nil {
		t.Fatal(err)
	}
}

func endMRX008Encounter(t *testing.T, encounter relay.EncounterPlan, winnerMemberID string, draw bool) {
	t.Helper()
	if draw {
		if _, err := pool.Exec(ctx, `
			UPDATE multi_relay_encounter
			SET status = 'ended', winner_member_id = NULL, outcome = 'draw', ended_at = clock_timestamp(),
			    turn_member_id = NULL, turn_deadline = NULL
			WHERE id = $1 AND status <> 'ended'`, encounter.EncounterID); err != nil {
			t.Fatal(err)
		}
		return
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_encounter
		SET status = 'ended', winner_member_id = $2, outcome = 'win', ended_at = clock_timestamp(),
		    turn_member_id = NULL, turn_deadline = NULL
		WHERE id = $1 AND status <> 'ended'`, encounter.EncounterID, winnerMemberID); err != nil {
		t.Fatal(err)
	}
}

func loadMRX008StageEndedEvent(t *testing.T, roomID string, stageIndex int) multi.RelayStageEndedPayload {
	t.Helper()
	var payload []byte
	if err := pool.QueryRow(ctx, `
		SELECT payload FROM room_event
		WHERE room_id = $1 AND type = 'relay.stage.ended' AND payload->>'stageIndex' = $2
		ORDER BY sequence DESC LIMIT 1`, roomID, fmt.Sprint(stageIndex)).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var event multi.RelayStageEndedPayload
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatal(err)
	}
	return event
}

func loadMRX008MatchEndedEvent(t *testing.T, roomID string) multi.MatchEndedEventPayload {
	t.Helper()
	var payload []byte
	if err := pool.QueryRow(ctx, `
		SELECT payload FROM room_event
		WHERE room_id = $1 AND type = 'match.ended'
		ORDER BY sequence DESC LIMIT 1`, roomID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var event multi.MatchEndedEventPayload
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatal(err)
	}
	return event
}

func loadMRX008Snapshot(t *testing.T, fixture mrx005Fixture, memberID string) openapi.RoomSnapshot {
	t.Helper()
	token := "mrx008-" + multi.NewID()
	if _, err := pool.Exec(ctx, `UPDATE multi_member SET token_hash = $1 WHERE id = $2`, multi.HashToken(token), memberID); err != nil {
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
	return snapshot
}

func mrx008SettlementByMember(settlement []multi.RelayStageSettlementView) map[string]multi.RelayStageSettlementView {
	byMember := make(map[string]multi.RelayStageSettlementView, len(settlement))
	for _, entry := range settlement {
		byMember[entry.MemberID] = entry
	}
	return byMember
}

func stageContainsMember(plan relay.StagePlan, memberID string) bool {
	if plan.Bye != nil && plan.Bye.MemberID == memberID {
		return true
	}
	for _, encounter := range plan.Encounters {
		for _, player := range encounter.Members {
			if player.MemberID == memberID {
				return true
			}
		}
	}
	return false
}
