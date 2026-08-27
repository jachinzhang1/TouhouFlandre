package server_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

type mrx006Clock struct {
	mu    sync.RWMutex
	value time.Time
}

func (c *mrx006Clock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.value
}

func (c *mrx006Clock) Set(value time.Time) {
	c.mu.Lock()
	c.value = value
	c.mu.Unlock()
}

type mrx006Fixture struct {
	base        mrx005Fixture
	clock       *mrx006Clock
	coordinator *relay.StageCoordinator
	service     *relayadapter.EncounterService
	plan        relay.StagePlan
}

type cancelingMRX006Clock struct {
	value    time.Time
	cancel   context.CancelFunc
	cancelAt int
	calls    int
}

func (c *cancelingMRX006Clock) Now() time.Time {
	c.calls++
	if c.calls == c.cancelAt {
		c.cancel()
	}
	return c.value
}

func createMRX006Fixture(t *testing.T, playerCount int, scoring relay.ScoringPolicy, ruleSet string) mrx006Fixture {
	t.Helper()
	base := createMRX005Fixture(t, playerCount)
	if _, err := pool.Exec(ctx, `UPDATE multi_match SET question_scope = NULL WHERE id = $1`, base.match.MatchID); err != nil {
		t.Fatal(err)
	}
	if ruleSet != "" {
		if _, err := pool.Exec(ctx, `
			UPDATE multi_match
			SET rule_set_key = $2,
			    rule_set_version = $3,
			    rule_config_snapshot = jsonb_build_object(
			        'mode', 'relay', 'ruleSetKey', $2::text, 'ruleSetVersion', $3::int
			    )
			WHERE id = $1`, base.match.MatchID, ruleSet, relay.RuleVersion); err != nil {
			t.Fatal(err)
		}
	}
	clock := &mrx006Clock{value: time.Now().UTC()}
	if scoring == nil {
		scoring = &mrx005Scoring{}
	}
	coordinator, err := relay.NewStageCoordinator(
		relayadapter.NewStageRepository(pool), relay.RandomPairingPolicy{},
		relayadapter.NewEncounterProvisioner(pool, mrx005Random{}, 5*time.Minute), scoring,
		clock, mrx005Random{}, &mrx005IDs{prefix: "mrx006-" + multi.NewID()}, time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	created, err := coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: base.match, StageIndex: 1, ActivePlayers: base.players,
		StartsAt: clock.Now().Add(-time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	return mrx006Fixture{
		base: base, clock: clock, coordinator: coordinator,
		service: relayadapter.NewEncounterService(pool, clock, coordinator, time.Minute),
		plan:    created.Plan,
	}
}

func TestMRX006StageAnswersAreUniqueForSupportedRosters(t *testing.T) {
	for _, playerCount := range []int{2, 4, 6, 8} {
		t.Run(fmt.Sprintf("players-%d", playerCount), func(t *testing.T) {
			fixture := createMRX006Fixture(t, playerCount, &mrx005Scoring{}, "")
			if len(fixture.plan.Encounters) != playerCount/2 {
				t.Fatalf("encounters=%d want=%d", len(fixture.plan.Encounters), playerCount/2)
			}
			seen := map[string]struct{}{}
			for _, encounter := range fixture.plan.Encounters {
				if _, duplicate := seen[encounter.AnswerID]; duplicate {
					t.Fatalf("duplicate stage answer %s in %+v", encounter.AnswerID, fixture.plan.Encounters)
				}
				seen[encounter.AnswerID] = struct{}{}
			}
			var persisted, distinct int
			if err := pool.QueryRow(ctx, `
				SELECT count(*)::int, count(DISTINCT answer_id)::int
				FROM multi_relay_encounter WHERE stage_id = $1`, fixture.plan.StageID).Scan(&persisted, &distinct); err != nil {
				t.Fatal(err)
			}
			if persisted != playerCount/2 || distinct != persisted {
				t.Fatalf("persisted=%d distinct=%d", persisted, distinct)
			}
		})
	}
}

func TestMRX006RecoveryReturnsRoomsCommittedBeforeLaterCandidateFailure(t *testing.T) {
	fixture := createMRX006Fixture(t, 4, &mrx005Scoring{}, "")
	sweepNow := time.Unix(120, 0).UTC()
	startsAt := time.Unix(60, 0).UTC()
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_stage SET starts_at = $2 WHERE id = $1`,
		fixture.plan.StageID, startsAt); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_encounter
		SET starts_at = $2,
		    deadline = $3,
		    turn_deadline = $4
		WHERE stage_id = $1`,
		fixture.plan.StageID, startsAt, sweepNow.Add(5*time.Minute), sweepNow.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `UPDATE multi_match SET status = 'finished' WHERE id = $1`, fixture.base.match.MatchID)
	})

	sweepCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	clock := &cancelingMRX006Clock{value: sweepNow, cancel: cancel, cancelAt: 3}
	service := relayadapter.NewEncounterService(pool, clock, fixture.coordinator, time.Minute)
	rooms, err := service.Sweep(sweepCtx, 10)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context cancellation", err)
	}
	if !slices.Contains(rooms, fixture.base.roomID) {
		t.Fatalf("rooms = %v, want committed room %s", rooms, fixture.base.roomID)
	}

	var startedEncounters, startedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_encounter WHERE stage_id = $1 AND status = 'playing'),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.encounter.started')`,
		fixture.plan.StageID, fixture.base.roomID).Scan(&startedEncounters, &startedEvents); err != nil {
		t.Fatal(err)
	}
	if startedEncounters != 1 || startedEvents != 1 {
		t.Fatalf("started encounters=%d events=%d", startedEncounters, startedEvents)
	}
}

func TestMRX006SmallQuestionPoolRollsBackWholeStage(t *testing.T) {
	base := createMRX005Fixture(t, 4)
	clock := &mrx006Clock{value: time.Now().UTC()}
	coordinator, err := relay.NewStageCoordinator(
		relayadapter.NewStageRepository(pool), relay.RandomPairingPolicy{},
		relay.QuestionProvisioner{Random: mrx005Random{}}, &mrx005Scoring{},
		clock, mrx005Random{}, &mrx005IDs{prefix: "mrx006-small-" + multi.NewID()}, time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = coordinator.CreateStage(ctx, relay.CreateStageRequest{
		Match: base.match, StageIndex: 1, ActivePlayers: base.players, StartsAt: clock.Now(),
		CandidateAnswerIDs: []string{"only-one"}, TurnSeconds: 30, EncounterDuration: time.Minute,
	})
	if !errors.Is(err, relay.ErrQuestionPoolTooSmall) {
		t.Fatalf("error=%v", err)
	}
	var stages, encounters, events int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $1),
			(SELECT count(*)::int FROM multi_relay_encounter WHERE match_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2)
		`, base.match.MatchID, base.roomID).Scan(&stages, &encounters, &events); err != nil {
		t.Fatal(err)
	}
	if stages != 0 || encounters != 0 || events != 0 {
		t.Fatalf("failed stage leaked stages=%d encounters=%d events=%d", stages, encounters, events)
	}
}

func TestMRX006EncounterIsolationAuthorizationAndBarrier(t *testing.T) {
	scoring := &mrx005Scoring{}
	fixture := createMRX006Fixture(t, 4, scoring, "")
	first, second := fixture.plan.Encounters[0], fixture.plan.Encounters[1]
	wrong := mrx006WrongGuess(t, fixture.plan)

	_, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: first.EncounterID,
		ActorMemberID: second.TurnMemberID, Action: relayadapter.EncounterActionPass, IdempotencyKey: "cross-board",
	})
	if !errors.Is(err, relay.ErrNotEncounterPlayer) {
		t.Fatalf("cross-board error=%v", err)
	}
	nonTurn := otherMRX006Member(first, first.TurnMemberID)
	_, err = fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: first.EncounterID,
		ActorMemberID: nonTurn, Action: relayadapter.EncounterActionPass, IdempotencyKey: "not-turn",
	})
	if !errors.Is(err, relay.ErrNotYourTurn) {
		t.Fatalf("non-turn error=%v", err)
	}

	ended, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: first.EncounterID,
		ActorMemberID: first.TurnMemberID, Action: relayadapter.EncounterActionGuess,
		GuessID: first.AnswerID, IdempotencyKey: "first-correct",
	})
	if err != nil || !ended.Accepted || !ended.Ended {
		t.Fatalf("first terminal result=%+v err=%v", ended, err)
	}
	accepted, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: second.EncounterID,
		ActorMemberID: second.TurnMemberID, Action: relayadapter.EncounterActionGuess,
		GuessID: wrong, IdempotencyKey: "sibling-still-active",
	})
	if err != nil || !accepted.Accepted || accepted.Ended {
		t.Fatalf("sibling action result=%+v err=%v", accepted, err)
	}
	var stageStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM multi_relay_stage WHERE id = $1`, fixture.plan.StageID).Scan(&stageStatus); err != nil {
		t.Fatal(err)
	}
	if stageStatus == "ended" {
		t.Fatal("one ended encounter settled the stage")
	}

	var turnCount, eventCount int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_turn WHERE encounter_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND payload ->> 'encounterId' = $1)
		`, first.EncounterID, fixture.base.roomID).Scan(&turnCount, &eventCount); err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: first.EncounterID,
		ActorMemberID: first.TurnMemberID, Action: relayadapter.EncounterActionPass, IdempotencyKey: "after-end",
	})
	if !errors.Is(err, relay.ErrEncounterEnded) {
		t.Fatalf("ended action error=%v", err)
	}
	var turnCountAfter, eventCountAfter int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_turn WHERE encounter_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND payload ->> 'encounterId' = $1)
		`, first.EncounterID, fixture.base.roomID).Scan(&turnCountAfter, &eventCountAfter); err != nil {
		t.Fatal(err)
	}
	if turnCountAfter != turnCount || eventCountAfter != eventCount {
		t.Fatalf("ended action wrote state: turns %d->%d events %d->%d", turnCount, turnCountAfter, eventCount, eventCountAfter)
	}

	current := mrx006TurnMember(t, second.EncounterID)
	final, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: second.EncounterID,
		ActorMemberID: current, Action: relayadapter.EncounterActionGuess,
		GuessID: second.AnswerID, IdempotencyKey: "second-correct",
	})
	if err != nil || !final.Ended {
		t.Fatalf("second terminal result=%+v err=%v", final, err)
	}
	assertMRX006SingleSettlement(t, fixture, scoring, 4)
}

func TestMRX006EncounterStoresRegistryWidthWhenVisibleFieldIsHidden(t *testing.T) {
	fixture := createMRX006Fixture(t, 2, &mrx005Scoring{}, "")
	scope := game.QuestionScopeConfig{
		SchemaVersion: game.QuestionScopeSchemaVersion,
		Mode:          game.QuestionScopeModeCustom,
		Difficulty:    game.QuestionDifficultyCustom,
		Rules: game.QuestionScopeRules{FieldModes: map[game.GuessFieldKey]string{
			game.FieldFirstAppearance: game.FieldModeHidden,
			game.FieldReleaseYear:     game.FieldModeDirectional,
			game.FieldSpecies:         game.FieldModeDefault,
			game.FieldAffiliations:    game.FieldModeDefault,
			game.FieldLocations:       game.FieldModeDefault,
			game.FieldHairColors:      game.FieldModeDefault,
		}},
	}
	scopeJSON, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE multi_match SET question_scope = $2 WHERE id = $1`, fixture.base.match.MatchID, scopeJSON); err != nil {
		t.Fatal(err)
	}
	encounter := fixture.plan.Encounters[0]
	result, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
		ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionGuess,
		GuessID: mrx006WrongGuess(t, fixture.plan), IdempotencyKey: "hidden-field-guess",
	})
	if err != nil || !result.Accepted || result.Guess == nil {
		t.Fatalf("hidden-field guess result=%+v err=%v", result, err)
	}
	if len(result.Guess.Feedback) != 5 {
		t.Fatalf("visible feedback width = %d, want 5", len(result.Guess.Feedback))
	}
	var storedWidth int
	if err := pool.QueryRow(ctx, `
		SELECT jsonb_array_length(statuses)
		FROM multi_relay_turn
		WHERE encounter_id = $1 AND idempotency_key = 'hidden-field-guess'`, encounter.EncounterID).Scan(&storedWidth); err != nil {
		t.Fatal(err)
	}
	if storedWidth != len(game.CharacterGuessFields) {
		t.Fatalf("stored feedback width = %d, want %d", storedWidth, len(game.CharacterGuessFields))
	}
}

func TestMRX006SameGuessIsScopedToEncounter(t *testing.T) {
	fixture := createMRX006Fixture(t, 4, &mrx005Scoring{}, "")
	guessID := mrx006WrongGuess(t, fixture.plan)
	for index, encounter := range fixture.plan.Encounters {
		result, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
			RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
			ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionGuess,
			GuessID: guessID, IdempotencyKey: fmt.Sprintf("same-guess-%d", index),
		})
		if err != nil || !result.Accepted {
			t.Fatalf("encounter %d result=%+v err=%v", index, result, err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)::int FROM multi_relay_turn
		WHERE match_id = $1 AND guess_id = $2`, fixture.base.match.MatchID, guessID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("same guess persisted %d times, want once per encounter", count)
	}
}

func TestMRX006FourConcurrentTerminalsSettleOnce(t *testing.T) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	scoring := &mrx005Scoring{}
	fixture := createMRX006Fixture(t, 8, scoring, "")
	if _, err := fixture.service.Sweep(ctx, 20); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errorsCh := make(chan error, len(fixture.plan.Encounters))
	var wg sync.WaitGroup
	for index, encounter := range fixture.plan.Encounters {
		index, encounter := index, encounter
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
				RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
				ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionGuess,
				GuessID: encounter.AnswerID, IdempotencyKey: fmt.Sprintf("parallel-correct-%d", index),
			})
			if err != nil {
				errorsCh <- err
				return
			}
			if !result.Ended {
				errorsCh <- fmt.Errorf("encounter %s did not end", encounter.EncounterID)
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	assertMRX006SingleSettlement(t, fixture, scoring, 8)

	var count, distinct, minSequence, maxSequence int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)::int, count(DISTINCT sequence)::int,
		       min(sequence)::int, max(sequence)::int
		FROM room_event WHERE room_id = $1`, fixture.base.roomID).Scan(&count, &distinct, &minSequence, &maxSequence); err != nil {
		t.Fatal(err)
	}
	if count != distinct || maxSequence-minSequence+1 != count {
		t.Fatalf("event sequence count=%d distinct=%d range=%d..%d", count, distinct, minSequence, maxSequence)
	}
}

func TestMRX006ConcurrentCorrectAndIdempotentReplayHaveOneTerminal(t *testing.T) {
	scoring := &mrx005Scoring{}
	fixture := createMRX006Fixture(t, 2, scoring, "")
	encounter := fixture.plan.Encounters[0]
	if _, err := fixture.service.Sweep(ctx, 10); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan relayadapter.EncounterActionResult, 2)
	errorsCh := make(chan error, 2)
	var wg sync.WaitGroup
	for index := 0; index < 2; index++ {
		index := index
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
				RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
				ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionGuess,
				GuessID: encounter.AnswerID, IdempotencyKey: fmt.Sprintf("correct-race-%d", index),
			})
			results <- result
			errorsCh <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errorsCh)
	successes, endedErrors := 0, 0
	for result := range results {
		if result.Accepted && result.Ended {
			successes++
		}
	}
	for err := range errorsCh {
		if err == nil {
			continue
		}
		if errors.Is(err, relay.ErrEncounterEnded) {
			endedErrors++
			continue
		}
		t.Fatal(err)
	}
	if successes != 1 || endedErrors != 1 {
		t.Fatalf("successes=%d endedErrors=%d", successes, endedErrors)
	}

	var key string
	if err := pool.QueryRow(ctx, `
		SELECT idempotency_key FROM multi_relay_turn WHERE encounter_id = $1`, encounter.EncounterID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	replay, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
		ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionGuess,
		GuessID: encounter.AnswerID, IdempotencyKey: key,
	})
	if err != nil || !replay.Accepted || !replay.Ended || replay.Turn == nil || replay.Guess == nil || !replay.Guess.IsCorrect {
		t.Fatalf("terminal replay=%+v err=%v", replay, err)
	}
	assertMRX006SingleSettlement(t, fixture, scoring, 2)
}

func TestMRX006ExpiredGuessAndSweeperCreateOneTimeoutTerminal(t *testing.T) {
	scoring := &mrx005Scoring{}
	fixture := createMRX006Fixture(t, 2, scoring, "")
	encounter := fixture.plan.Encounters[0]
	if _, err := fixture.service.Sweep(ctx, 10); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 4; index++ {
		actor := mrx006TurnMember(t, encounter.EncounterID)
		if _, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
			RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
			ActorMemberID: actor, Action: relayadapter.EncounterActionPass,
			IdempotencyKey: fmt.Sprintf("pre-timeout-pass-%d", index),
		}); err != nil {
			t.Fatal(err)
		}
	}
	actor := mrx006TurnMember(t, encounter.EncounterID)
	expired := fixture.clock.Now().Add(-time.Millisecond)
	if _, err := pool.Exec(ctx, `UPDATE multi_relay_encounter SET turn_deadline = $2 WHERE id = $1`, encounter.EncounterID, expired); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errorsCh := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		_, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
			RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
			ActorMemberID: actor, Action: relayadapter.EncounterActionGuess,
			GuessID: encounter.AnswerID, IdempotencyKey: "guess-vs-timeout",
		})
		if err != nil && !errors.Is(err, relay.ErrEncounterEnded) {
			errorsCh <- err
		}
	}()
	go func() {
		defer wg.Done()
		<-start
		_, err := fixture.service.Sweep(ctx, 10)
		if err != nil {
			errorsCh <- err
		}
	}()
	close(start)
	wg.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	var turns, timeouts, endedEvents int
	var status, outcome string
	if err := pool.QueryRow(ctx, `
		SELECT encounter.status, encounter.outcome,
		       (SELECT count(*)::int FROM multi_relay_turn WHERE encounter_id = encounter.id),
		       (SELECT count(*)::int FROM multi_relay_turn WHERE encounter_id = encounter.id AND kind = 'timeout'),
		       (SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.encounter.ended')
		FROM multi_relay_encounter AS encounter WHERE encounter.id = $1
		`, encounter.EncounterID, fixture.base.roomID).Scan(&status, &outcome, &turns, &timeouts, &endedEvents); err != nil {
		t.Fatal(err)
	}
	if status != "ended" || outcome != "loss" || turns != 5 || timeouts != 1 || endedEvents != 1 {
		t.Fatalf("status=%s outcome=%s turns=%d timeouts=%d endedEvents=%d", status, outcome, turns, timeouts, endedEvents)
	}
	assertMRX006SingleSettlement(t, fixture, scoring, 2)
}

func TestMRX006PassAndDisconnectEndLegacyMatchOnce(t *testing.T) {
	fixture := createMRX006Fixture(t, 2, relay.LegacyWinsPolicy{}, relay.RuleLegacyWins)
	encounter := fixture.plan.Encounters[0]
	if _, err := fixture.service.Sweep(ctx, 10); err != nil {
		t.Fatal(err)
	}
	member := repo.MultiMember{ID: encounter.TurnMemberID, RoomID: fixture.base.roomID}
	start := make(chan struct{})
	errorsCh := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		_, err := fixture.service.Act(ctx, relayadapter.EncounterActionInput{
			RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
			ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionPass,
			IdempotencyKey: "pass-vs-disconnect",
		})
		if err != nil && !errors.Is(err, relay.ErrEncounterEnded) {
			errorsCh <- err
		}
	}()
	go func() {
		defer wg.Done()
		<-start
		handled, err := fixture.service.ForfeitMatchMember(ctx, member, multi.MatchEndReasonDisconnect)
		if err != nil {
			errorsCh <- err
		} else if !handled {
			errorsCh <- errors.New("relay disconnect was not handled")
		}
	}()
	close(start)
	wg.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Fatal(err)
	}
	var roomStatus, matchStatus, encounterStatus, memberStatus string
	var score1, score2, matchEndedEvents, encounterEndedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT room.status, match.status, encounter.status, member.status,
		       match.score_slot1, match.score_slot2,
		       (SELECT count(*)::int FROM room_event WHERE room_id = room.id AND type = 'match.ended'),
		       (SELECT count(*)::int FROM room_event WHERE room_id = room.id AND type = 'relay.encounter.ended')
		FROM multi_room AS room
		JOIN multi_match AS match ON match.id = $1
		JOIN multi_relay_encounter AS encounter ON encounter.id = $2
		JOIN multi_member AS member ON member.id = $3
		WHERE room.id = $4
		`, fixture.base.match.MatchID, encounter.EncounterID, member.ID, fixture.base.roomID).
		Scan(&roomStatus, &matchStatus, &encounterStatus, &memberStatus, &score1, &score2, &matchEndedEvents, &encounterEndedEvents); err != nil {
		t.Fatal(err)
	}
	if roomStatus != "finished" || matchStatus != "finished" || encounterStatus != "ended" || memberStatus != "left" ||
		score1 != 0 || score2 != 0 || matchEndedEvents != 1 || encounterEndedEvents != 1 {
		t.Fatalf("room=%s match=%s encounter=%s member=%s score=%d:%d events=%d/%d",
			roomStatus, matchStatus, encounterStatus, memberStatus, score1, score2, matchEndedEvents, encounterEndedEvents)
	}
	var reason string
	if err := pool.QueryRow(ctx, `
		SELECT payload ->> 'reason' FROM room_event
		WHERE room_id = $1 AND type = 'match.ended'`, fixture.base.roomID).Scan(&reason); err != nil {
		t.Fatal(err)
	}
	if reason != "disconnect" {
		t.Fatalf("match end reason=%s", reason)
	}
}

func TestMRX006CanonicalActionHydratesFeedbackAndHidesActiveAnswer(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "relay", 30)
	snapshot := startMatch(t, fixture)
	if snapshot.Match == nil || snapshot.Match.Relay == nil || snapshot.Match.Relay.CurrentStage == nil ||
		snapshot.Match.Relay.CurrentStage.EncounterDetails == nil || len(*snapshot.Match.Relay.CurrentStage.EncounterDetails) != 1 {
		t.Fatalf("relay snapshot=%+v", snapshot.Match)
	}
	detail := (*snapshot.Match.Relay.CurrentStage.EncounterDetails)[0]
	if detail.Answer != nil {
		t.Fatalf("active snapshot leaked answer=%+v", detail.Answer)
	}
	answer := currentAnswer(t, fixture.roomID)
	path := "/api/rooms/" + fixture.roomID + "/stages/1/encounters/" + detail.EncounterId + "/actions"
	body := map[string]any{"action": "guess", "guessId": answer, "idempotencyKey": "canonical-correct"}
	resp, payload := fastRequestAuth(http.MethodPost, path, fixture.hostToken, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("canonical guess=%d %s", resp.StatusCode, payload)
	}
	var action openapi.RelayEncounterActionResponse
	if err := json.Unmarshal(payload, &action); err != nil {
		t.Fatal(err)
	}
	if !action.Accepted || !action.Ended || action.Turn == nil || action.Turn.Guess == nil ||
		!action.Turn.Guess.IsCorrect || action.Turn.Guess.GuessId != answer || len(action.Turn.Guess.Feedback) == 0 {
		t.Fatalf("canonical response=%+v", action)
	}
	resp, replayPayload := fastRequestAuth(http.MethodPost, path, fixture.hostToken, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("canonical replay=%d %s", resp.StatusCode, replayPayload)
	}
	var replay openapi.RelayEncounterActionResponse
	if err := json.Unmarshal(replayPayload, &replay); err != nil {
		t.Fatal(err)
	}
	if !replay.Accepted || !replay.Ended || replay.Turn == nil || replay.Turn.Guess == nil || !replay.Turn.Guess.IsCorrect {
		t.Fatalf("canonical replay=%+v", replay)
	}

	terminal := startMatchSnapshot(t, fixture)
	terminalDetail := (*terminal.Match.Relay.CurrentStage.EncounterDetails)[0]
	if terminalDetail.Answer == nil || terminalDetail.Answer.Id != answer {
		t.Fatalf("terminal answer=%+v want=%s", terminalDetail.Answer, answer)
	}
	resp, errorPayload := fastRequestAuth(http.MethodPost, path, fixture.hostToken,
		map[string]any{"action": "pass", "idempotencyKey": "after-terminal"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("ended action=%d %s", resp.StatusCode, errorPayload)
	}
	if string(errorPayload) == "" || containsJSONValue(errorPayload, answer) {
		t.Fatalf("terminal error leaked answer: %s", errorPayload)
	}
	var turns, guessEvents, endedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM multi_relay_turn WHERE encounter_id = $1),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.encounter.turn.guess'),
			(SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.encounter.ended')
		`, detail.EncounterId, fixture.roomID).Scan(&turns, &guessEvents, &endedEvents); err != nil {
		t.Fatal(err)
	}
	if turns != 1 || guessEvents != 1 || endedEvents != 1 {
		t.Fatalf("idempotent counts turns=%d guesses=%d ended=%d", turns, guessEvents, endedEvents)
	}
}

func TestMRX006LegacyRelayLeaveAndDisconnectUseEncounterStorage(t *testing.T) {
	for _, test := range []struct {
		name   string
		reason multi.MatchEndReason
	}{
		{name: "leave", reason: multi.MatchEndReasonForfeit},
		{name: "disconnect", reason: multi.MatchEndReasonDisconnect},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := createMatchFixtureMode(t, "bo3", "relay", 30)
			startMatch(t, fixture)
			if test.reason == multi.MatchEndReasonForfeit {
				resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.joinerToken, nil)
				if resp.StatusCode != http.StatusNoContent {
					t.Fatalf("relay leave=%d %s", resp.StatusCode, payload)
				}
			} else {
				if _, err := pool.Exec(ctx, `
					UPDATE multi_member
					SET status = 'disconnected', grace_until = now() - interval '1 second'
					WHERE room_id = $1 AND seat = 2`, fixture.roomID); err != nil {
					t.Fatal(err)
				}
				if err := fastSweeper().SweepOnce(ctx); err != nil {
					t.Fatal(err)
				}
			}
			var roomStatus, matchStatus, encounterStatus, memberStatus, reason string
			var score1, score2 int
			if err := pool.QueryRow(ctx, `
				SELECT room.status, match.status, encounter.status, member.status,
				       match.score_slot1, match.score_slot2,
				       (SELECT payload ->> 'reason' FROM room_event
				        WHERE room_id = room.id AND type = 'match.ended'
				        ORDER BY sequence DESC LIMIT 1)
				FROM multi_room AS room
				JOIN multi_match AS match ON match.room_id = room.id AND match.match_index = 0
				JOIN multi_relay_stage AS stage ON stage.match_id = match.id AND stage.stage_index = 1
				JOIN multi_relay_encounter AS encounter ON encounter.stage_id = stage.id
				JOIN multi_member AS member ON member.room_id = room.id AND member.seat = 2
				WHERE room.id = $1`, fixture.roomID).
				Scan(&roomStatus, &matchStatus, &encounterStatus, &memberStatus, &score1, &score2, &reason); err != nil {
				t.Fatal(err)
			}
			if roomStatus != "finished" || matchStatus != "finished" || encounterStatus != "ended" ||
				memberStatus != "left" || score1 != 0 || score2 != 0 || reason != string(test.reason) {
				t.Fatalf("room=%s match=%s encounter=%s member=%s score=%d:%d reason=%s",
					roomStatus, matchStatus, encounterStatus, memberStatus, score1, score2, reason)
			}
		})
	}
}

func TestMRX006RestartedMatchUsesModeOwnedRecovery(t *testing.T) {
	fixture := createMRX006Fixture(t, 2, relay.LegacyWinsPolicy{}, relay.RuleLegacyWins)
	encounter := fixture.plan.Encounters[0]
	if _, err := multi.TerminateActiveMatches(ctx, pool, fixture.clock.Now(), fastTiming, assembly.MustProduction()); err != nil {
		t.Fatal(err)
	}
	var eventsBefore int
	if err := pool.QueryRow(ctx, `SELECT count(*)::int FROM room_event WHERE room_id = $1`, fixture.base.roomID).Scan(&eventsBefore); err != nil {
		t.Fatal(err)
	}
	fixture.clock.Set(fixture.clock.Now().Add(10 * time.Minute))
	timing := multi.DefaultTimingConfig()
	_, service, err := relayadapter.NewRuntime(pool, fixture.clock, mrx005Random{}, timing)
	if err != nil {
		t.Fatal(err)
	}
	rooms, err := service.Sweep(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	foundRoom := false
	for _, roomID := range rooms {
		foundRoom = foundRoom || roomID == fixture.base.roomID
	}
	if !foundRoom {
		t.Fatalf("recovery rooms=%v", rooms)
	}
	_, err = fixture.service.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: fixture.base.roomID, StageIndex: 1, EncounterID: encounter.EncounterID,
		ActorMemberID: encounter.TurnMemberID, Action: relayadapter.EncounterActionPass,
		IdempotencyKey: "after-server-restart",
	})
	if !errors.Is(err, relay.ErrEncounterEnded) {
		t.Fatalf("post-restart action error=%v", err)
	}
	var eventsAfter, turns, matchEndedEvents, stages int
	var matchStatus, encounterStatus string
	if err := pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM room_event WHERE room_id = $1),
			(SELECT count(*)::int FROM multi_relay_turn WHERE encounter_id = $2),
			(SELECT count(*)::int FROM room_event WHERE room_id = $1 AND type = 'match.ended'),
			(SELECT count(*)::int FROM multi_relay_stage WHERE match_id = $3),
			(SELECT status FROM multi_match WHERE id = $3),
			(SELECT status FROM multi_relay_encounter WHERE id = $2)
		`, fixture.base.roomID, encounter.EncounterID, fixture.base.match.MatchID).
		Scan(&eventsAfter, &turns, &matchEndedEvents, &stages, &matchStatus, &encounterStatus); err != nil {
		t.Fatal(err)
	}
	if eventsAfter <= eventsBefore || turns != 0 || matchEndedEvents != 0 || stages != 2 ||
		matchStatus != "playing" || encounterStatus != "ended" {
		t.Fatalf("events=%d->%d turns=%d matchEnded=%d stages=%d match=%s encounter=%s",
			eventsBefore, eventsAfter, turns, matchEndedEvents, stages, matchStatus, encounterStatus)
	}
}

func mrx006WrongGuess(t *testing.T, plan relay.StagePlan) string {
	t.Helper()
	match, err := repo.New(pool).GetRelayMatch(ctx, plan.Match.MatchID)
	if err != nil {
		t.Fatal(err)
	}
	characters, err := multi.CharactersForVersion(ctx, repo.New(pool), match.CatalogVersion)
	if err != nil {
		t.Fatal(err)
	}
	answers := make(map[string]struct{}, len(plan.Encounters))
	for _, encounter := range plan.Encounters {
		answers[encounter.AnswerID] = struct{}{}
	}
	for _, character := range characters {
		if character.EnabledAsGuess {
			if _, answer := answers[character.ID]; !answer {
				return character.ID
			}
		}
	}
	t.Fatal("no wrong guess is available")
	return ""
}

func otherMRX006Member(encounter relay.EncounterPlan, memberID string) string {
	if encounter.Members[0].MemberID == memberID {
		return encounter.Members[1].MemberID
	}
	return encounter.Members[0].MemberID
}

func mrx006TurnMember(t *testing.T, encounterID string) string {
	t.Helper()
	var memberID string
	if err := pool.QueryRow(ctx, `
		SELECT turn_member_id FROM multi_relay_encounter WHERE id = $1`, encounterID).Scan(&memberID); err != nil {
		t.Fatal(err)
	}
	return memberID
}

func assertMRX006SingleSettlement(t *testing.T, fixture mrx006Fixture, scoring *mrx005Scoring, playerCount int) {
	t.Helper()
	var status string
	var settlementRows, stageEndedEvents int
	if err := pool.QueryRow(ctx, `
		SELECT stage.status,
		       (SELECT count(*)::int FROM multi_relay_stage_player WHERE stage_id = stage.id),
		       (SELECT count(*)::int FROM room_event WHERE room_id = $2 AND type = 'relay.stage.ended')
		FROM multi_relay_stage AS stage WHERE stage.id = $1
		`, fixture.plan.StageID, fixture.base.roomID).Scan(&status, &settlementRows, &stageEndedEvents); err != nil {
		t.Fatal(err)
	}
	if status != "ended" || settlementRows != playerCount || stageEndedEvents != 1 || scoring.calls.Load() != 1 {
		t.Fatalf("stage=%s settlements=%d events=%d scoring=%d", status, settlementRows, stageEndedEvents, scoring.calls.Load())
	}
}

func containsJSONValue(payload []byte, value string) bool {
	var decoded any
	if json.Unmarshal(payload, &decoded) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(current any) bool {
		switch typed := current.(type) {
		case string:
			return typed == value
		case []any:
			for _, item := range typed {
				if visit(item) {
					return true
				}
			}
		case map[string]any:
			for _, item := range typed {
				if visit(item) {
					return true
				}
			}
		}
		return false
	}
	return visit(decoded)
}
