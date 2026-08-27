package server_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

func TestMRX009SimultaneousDisconnectsInSameRelayEncounterDraw(t *testing.T) {
	fixture := createMRX006Fixture(t, 2, relay.LegacyWinsPolicy{}, relay.RuleLegacyWins)
	replaceMRX007AnswersWithCatalog(t, fixture.plan)
	if _, err := pool.Exec(ctx, `
		UPDATE multi_member
		SET status = 'disconnected', grace_until = now() - interval '1 second'
		WHERE room_id = $1`, fixture.base.roomID); err != nil {
		t.Fatal(err)
	}

	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}

	var encounterStatus, outcome, matchStatus, reason string
	var winner *string
	var leftMembers int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT status FROM multi_relay_encounter WHERE id = $2),
			(SELECT outcome FROM multi_relay_encounter WHERE id = $2),
			(SELECT winner_member_id FROM multi_relay_encounter WHERE id = $2),
			(SELECT status FROM multi_match WHERE id = $3),
			(SELECT payload ->> 'reason' FROM room_event WHERE room_id = $1 AND type = 'match.ended' ORDER BY sequence DESC LIMIT 1),
			(SELECT count(*)::int FROM multi_member WHERE room_id = $1 AND status = 'left')`,
		fixture.base.roomID, fixture.plan.Encounters[0].EncounterID, fixture.base.match.MatchID).
		Scan(&encounterStatus, &outcome, &winner, &matchStatus, &reason, &leftMembers); err != nil {
		t.Fatal(err)
	}
	if encounterStatus != "ended" || outcome != "draw" || winner != nil || matchStatus != "finished" || reason != "disconnect" || leftMembers != 2 {
		t.Fatalf("encounter=%s outcome=%s winner=%v match=%s reason=%s left=%d",
			encounterStatus, outcome, winner, matchStatus, reason, leftMembers)
	}
}

func TestMRX009FixedPointsDepartureOnlyEndsOwnedEncounterAndContinues(t *testing.T) {
	fixture := createMRX007Fixture(t, 4, "bo3", 3)
	clock := &mrx006Clock{value: time.Now().UTC()}
	timing := multi.DefaultTimingConfig()
	timing.Intermission = 0
	coordinator, service, err := relayadapter.NewRuntime(pool, clock, mrx005Random{}, timing)
	if err != nil {
		t.Fatal(err)
	}
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: clock.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	departedID := created.Plan.Encounters[0].Members[1].MemberID
	member, err := repo.New(pool).GetMember(ctx, departedID)
	if err != nil {
		t.Fatal(err)
	}
	handled, err := service.ForfeitMatchMember(ctx, member, multi.MatchEndReasonForfeit)
	if err != nil {
		t.Fatal(err)
	}
	if !handled {
		t.Fatal("relay forfeiter did not handle fixed-points departure")
	}

	var firstStatus, secondStatus, matchStatus string
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT status FROM multi_relay_encounter WHERE id = $1),
			(SELECT status FROM multi_relay_encounter WHERE id = $2),
			(SELECT status FROM multi_match WHERE id = $3)`,
		created.Plan.Encounters[0].EncounterID, created.Plan.Encounters[1].EncounterID, fixture.match.MatchID).
		Scan(&firstStatus, &secondStatus, &matchStatus); err != nil {
		t.Fatal(err)
	}
	if firstStatus != "ended" || secondStatus == "ended" || matchStatus != "playing" {
		t.Fatalf("first=%s second=%s match=%s", firstStatus, secondStatus, matchStatus)
	}

	endMRX007Encounter(t, created.Plan.Encounters[1], false)
	settled, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if !settled.Owner || settled.NextStage == nil || len(settled.NextStage.Encounters) != 1 || settled.NextStage.Bye == nil {
		t.Fatalf("settlement = %+v", settled)
	}
	if stageContainsMember(*settled.NextStage, departedID) {
		t.Fatalf("left player %s appeared in next stage %+v", departedID, settled.NextStage)
	}
}

func TestMRX009EliminationDepartureDoesNotConsumeNearDeath(t *testing.T) {
	fixture := createMRX008Fixture(t, 4)
	clock := &mrx006Clock{value: time.Now().UTC()}
	timing := multi.DefaultTimingConfig()
	timing.Intermission = 0
	coordinator, service, err := relayadapter.NewRuntime(pool, clock, mrx005Random{}, timing)
	if err != nil {
		t.Fatal(err)
	}
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: fixture.match, StageIndex: 1, ActivePlayers: fixture.players, StartsAt: clock.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	departedID := created.Plan.Encounters[0].Members[1].MemberID
	setMRX008PlayerState(t, fixture, departedID, 0, relay.LifeStateNearDeath, "active", nil)
	member, err := repo.New(pool).GetMember(ctx, departedID)
	if err != nil {
		t.Fatal(err)
	}
	if handled, err := service.ForfeitMatchMember(ctx, member, multi.MatchEndReasonForfeit); err != nil {
		t.Fatal(err)
	} else if !handled {
		t.Fatal("relay forfeiter did not handle elimination departure")
	}
	endMRX008Encounter(t, created.Plan.Encounters[1], created.Plan.Encounters[1].Members[0].MemberID, false)
	settled, err := coordinator.TrySettle(ctx, created.Plan.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if !settled.Owner || settled.NextStage == nil || stageContainsMember(*settled.NextStage, departedID) {
		t.Fatalf("settlement = %+v", settled)
	}

	var score, terminalStage int
	var life, status string
	if err := pool.QueryRow(ctx, `
		SELECT state.score, state.life_state, state.eliminated_stage, roster.status
		FROM multi_relay_match_player_state AS state
		JOIN multi_match_player AS roster USING (match_id, member_id)
		WHERE state.match_id = $1 AND state.member_id = $2`, fixture.match.MatchID, departedID).
		Scan(&score, &life, &terminalStage, &status); err != nil {
		t.Fatal(err)
	}
	if score != -1 || life != string(relay.LifeStateNearDeath) || terminalStage != 1 || status != "left" {
		t.Fatalf("departed score=%d life=%s stage=%d status=%s", score, life, terminalStage, status)
	}
	stageEvent := loadMRX008StageEndedEvent(t, fixture.roomID, 1)
	if len(stageEvent.EliminatedMemberIDs) != 0 {
		t.Fatalf("eliminated ids = %+v", stageEvent.EliminatedMemberIDs)
	}
	if mrx008SettlementByMember(stageEvent.Settlement)[departedID].LifeTransition != multi.RelayLifeTransitionNone {
		t.Fatalf("departed settlement = %+v", stageEvent.Settlement)
	}
}

func TestMRX009UnknownRelayRuleSetRecoveryEndsServerRestart(t *testing.T) {
	fixture := createMRX007Fixture(t, 4, "bo3", 3)
	clock := &mrx006Clock{value: time.Now().UTC()}
	timing := multi.DefaultTimingConfig()
	_, service, err := relayadapter.NewRuntime(pool, clock, mrx005Random{}, timing)
	if err != nil {
		t.Fatal(err)
	}
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
	if _, err := pool.Exec(ctx, `
		UPDATE multi_match
		SET rule_set_version = 2,
		    rule_config_snapshot = jsonb_set(rule_config_snapshot, '{ruleSetVersion}', '2'::jsonb)
		WHERE id = $1`, fixture.match.MatchID); err != nil {
		t.Fatal(err)
	}

	rooms, err := service.Sweep(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rooms) != 1 || rooms[0] != fixture.roomID {
		t.Fatalf("rooms = %+v", rooms)
	}
	var matchStatus, roomStatus, reason string
	var openEncounters, restartedEncounters int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT status FROM multi_match WHERE id = $1),
			(SELECT status FROM multi_room WHERE id = $2),
			(SELECT count(*)::int FROM multi_relay_encounter WHERE match_id = $1 AND status <> 'ended'),
			(SELECT count(*)::int FROM multi_relay_encounter WHERE match_id = $1 AND outcome = 'server_restart'),
			(SELECT payload ->> 'reason' FROM room_event WHERE room_id = $2 AND type = 'match.ended' ORDER BY sequence DESC LIMIT 1)`,
		fixture.match.MatchID, fixture.roomID).
		Scan(&matchStatus, &roomStatus, &openEncounters, &restartedEncounters, &reason); err != nil {
		t.Fatal(err)
	}
	if matchStatus != "finished" || roomStatus != "finished" || openEncounters != 0 ||
		restartedEncounters != len(created.Plan.Encounters) || reason != "server_restart" {
		t.Fatalf("match=%s room=%s open=%d restarted=%d reason=%s",
			matchStatus, roomStatus, openEncounters, restartedEncounters, reason)
	}
}

func TestMRX009RelayRematchAllowsEliminatedRosterAndResetsState(t *testing.T) {
	fixture := createMRX008Fixture(t, 4)
	eliminatedID := fixture.players[1].MemberID
	setMRX008PlayerState(t, fixture, eliminatedID, -2, relay.LifeStateNearDeath, "eliminated", mrx009IntPointer(1))
	if _, err := pool.Exec(ctx, `
		UPDATE multi_match
		SET status = 'finished', ended_at = clock_timestamp(), winner_member_id = $2
		WHERE id = $1`, fixture.match.MatchID, fixture.players[0].MemberID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_room
		SET status = 'finished', expires_at = now() + interval '1 hour'
		WHERE id = $1`, fixture.roomID); err != nil {
		t.Fatal(err)
	}

	tokens := make(map[string]string, len(fixture.players))
	for index, player := range fixture.players {
		token := "mrx009-rematch-" + player.MemberID
		tokens[player.MemberID] = token
		if _, err := pool.Exec(ctx, `
			UPDATE multi_member
			SET token_hash = $2, status = 'connected', grace_until = NULL, rematch_ready = false
			WHERE id = $1`, player.MemberID, multi.HashToken(token)); err != nil {
			t.Fatal(err)
		}
		if index > 0 {
			setMRX008PlayerState(t, fixture, player.MemberID, -1, relay.LifeStateNearDeath, "eliminated", mrx009IntPointer(1))
		}
	}

	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", tokens[eliminatedID], nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("eliminated rematch: %d %s", resp.StatusCode, payload)
	}
	for _, player := range fixture.players {
		if player.MemberID == eliminatedID {
			continue
		}
		resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", tokens[player.MemberID], nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("rematch %s: %d %s", player.MemberID, resp.StatusCode, payload)
		}
	}

	var roomStatus, ruleSet string
	var matchIndex, resetStates, activeRoster, stages, encounters int
	if err := pool.QueryRow(ctx, `
		WITH latest AS (
			SELECT * FROM multi_match WHERE room_id = $1 ORDER BY match_index DESC LIMIT 1
		)
		SELECT
			(SELECT status FROM multi_room WHERE id = $1),
			(SELECT match_index::int FROM latest),
			(SELECT rule_set_key FROM latest),
			(SELECT count(*)::int FROM multi_relay_match_player_state AS state
			 JOIN latest ON latest.id = state.match_id
			 WHERE state.score = 0 AND state.life_state = 'healthy' AND state.eliminated_stage IS NULL),
			(SELECT count(*)::int FROM multi_match_player AS player
			 JOIN latest ON latest.id = player.match_id
			 WHERE player.status = 'active' AND player.score = 0 AND player.wins = 0),
			(SELECT count(*)::int FROM multi_relay_stage AS stage
			 JOIN latest ON latest.id = stage.match_id),
			(SELECT count(*)::int FROM multi_relay_encounter AS encounter
			 JOIN latest ON latest.id = encounter.match_id)`, fixture.roomID).
		Scan(&roomStatus, &matchIndex, &ruleSet, &resetStates, &activeRoster, &stages, &encounters); err != nil {
		t.Fatal(err)
	}
	if roomStatus != "playing" || matchIndex != 1 || ruleSet != relay.RuleFixedPoints ||
		resetStates != len(fixture.players) || activeRoster != len(fixture.players) || stages != 1 || encounters != 2 {
		t.Fatalf("room=%s matchIndex=%d rule=%s reset=%d active=%d stages=%d encounters=%d",
			roomStatus, matchIndex, ruleSet, resetStates, activeRoster, stages, encounters)
	}
}

func TestMRX009SweeperWithoutRelayRecoveryDoesNotScanRelayTables(t *testing.T) {
	fixture := createMRX007Fixture(t, 4, "bo3", 3)
	clock := &mrx006Clock{value: time.Now().UTC()}
	timing := multi.DefaultTimingConfig()
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
	sweeper := multi.NewSweeper(pool, multi.SweeperConfig{
		Timing: fastTiming, EventRetention: time.Hour, Registry: assembly.MustProduction(),
		Clock: clock, Random: core.NewRandomSource(),
	})
	if err := sweeper.SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}

	var planned, startedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_encounter WHERE stage_id = $1 AND status = 'countdown'),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.encounter.started')`,
		created.Plan.StageID, fixture.roomID).Scan(&planned, &startedEvents); err != nil {
		t.Fatal(err)
	}
	if planned != len(created.Plan.Encounters) || startedEvents != 0 {
		t.Fatalf("countdown=%d startedEvents=%d", planned, startedEvents)
	}
}

func mrx009IntPointer(value int) *int { return &value }
