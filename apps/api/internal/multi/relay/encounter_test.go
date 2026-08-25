package relay_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

func TestFirstTurnPlayerAlternatesByStageAndSeat(t *testing.T) {
	members := [2]relay.PlayerSnapshot{{MemberID: "high", Seat: 8}, {MemberID: "low", Seat: 2}}
	for _, test := range []struct {
		stage int
		want  string
	}{{1, "low"}, {2, "high"}, {3, "low"}, {4, "high"}} {
		got, err := relay.FirstTurnPlayer(test.stage, members)
		if err != nil {
			t.Fatal(err)
		}
		if got.MemberID != test.want {
			t.Fatalf("stage %d first member=%s want=%s", test.stage, got.MemberID, test.want)
		}
	}
}

func TestQuestionProvisionerUsesUniqueStageAnswersAndResetsHistory(t *testing.T) {
	input := relay.StageProvisionInput{
		StageIndex: 2,
		StartsAt:   time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC),
		Pairing: relay.PairingPlan{Pairs: []relay.Pair{
			{EncounterIndex: 1, Members: [2]relay.PlayerSnapshot{{MemberID: "a", Seat: 1}, {MemberID: "b", Seat: 2}}},
			{EncounterIndex: 2, Members: [2]relay.PlayerSnapshot{{MemberID: "c", Seat: 3}, {MemberID: "d", Seat: 4}}},
		}},
		CandidateAnswerIDs: []string{"q1", "q2", "q3"},
		UsedAnswerIDs:      []string{"q1", "q2"},
		TurnSeconds:        30,
		EncounterDuration:  15 * time.Minute,
	}
	got, err := (relay.QuestionProvisioner{Random: &sequenceRandom{values: []int{0, 0}}}).Provision(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].AnswerID == got[1].AnswerID {
		t.Fatalf("provisioned answers=%+v", got)
	}
	if got[0].TurnMemberID != "b" || got[1].TurnMemberID != "d" {
		t.Fatalf("even-stage first turns=%+v", got)
	}
}

func TestQuestionProvisionerRejectsSmallPool(t *testing.T) {
	_, err := (relay.QuestionProvisioner{Random: &sequenceRandom{values: []int{0}}}).Provision(context.Background(), relay.StageProvisionInput{
		StageIndex: 1, StartsAt: time.Now(), TurnSeconds: 30, EncounterDuration: time.Minute,
		CandidateAnswerIDs: []string{"only"},
		Pairing: relay.PairingPlan{Pairs: []relay.Pair{
			{EncounterIndex: 1, Members: [2]relay.PlayerSnapshot{{MemberID: "a", Seat: 1}, {MemberID: "b", Seat: 2}}},
			{EncounterIndex: 2, Members: [2]relay.PlayerSnapshot{{MemberID: "c", Seat: 3}, {MemberID: "d", Seat: 4}}},
		}},
	})
	if !errors.Is(err, relay.ErrQuestionPoolTooSmall) {
		t.Fatalf("error=%v", err)
	}
}

func TestQuestionProvisionerCapsInitialTurnAtEncounterDeadline(t *testing.T) {
	startsAt := time.Now().UTC()
	got, err := (relay.QuestionProvisioner{Random: &sequenceRandom{values: []int{0}}}).Provision(context.Background(), relay.StageProvisionInput{
		StageIndex: 1, StartsAt: startsAt, TurnSeconds: 60, EncounterDuration: time.Second,
		CandidateAnswerIDs: []string{"answer"},
		Pairing: relay.PairingPlan{Pairs: []relay.Pair{{
			EncounterIndex: 1,
			Members:        [2]relay.PlayerSnapshot{{MemberID: "a", Seat: 1}, {MemberID: "b", Seat: 2}},
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[0].TurnDeadline.Equal(got[0].Deadline) {
		t.Fatalf("seed=%+v", got)
	}
}

func TestApplyTurnPreservesEncounterIsolationRules(t *testing.T) {
	now := time.Now()
	state := relay.EncounterState{
		ID: "encounter", Status: relay.EncounterStatusPlaying,
		Members:      [2]relay.PlayerSnapshot{{MemberID: "a", Seat: 1}, {MemberID: "b", Seat: 2}},
		TurnMemberID: "a", TurnDeadline: now, Deadline: now.Add(time.Minute), MaxTurnsPerPlayer: 2,
	}
	wrong := relay.Turn{Index: 1, MemberID: "a", Kind: relay.TurnKindGuess, GuessID: "q1"}
	got, err := relay.ApplyTurn(state, wrong, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if got.Ended || got.NextTurnMemberID == nil || *got.NextTurnMemberID != "b" {
		t.Fatalf("wrong guess transition=%+v", got)
	}

	state.Turns = []relay.Turn{
		{Index: 1, MemberID: "a", Kind: relay.TurnKindPass},
		{Index: 2, MemberID: "b", Kind: relay.TurnKindPass},
		{Index: 3, MemberID: "a", Kind: relay.TurnKindTimeout},
		{Index: 4, MemberID: "b", Kind: relay.TurnKindTimeout},
	}
	state.TurnMemberID = "a"
	thirdSkip := relay.Turn{Index: 5, MemberID: "a", Kind: relay.TurnKindPass}
	got, err = relay.ApplyTurn(state, thirdSkip, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if !got.Ended || got.Reason != relay.TerminalLoss || got.WinnerMemberID == nil || *got.WinnerMemberID != "b" {
		t.Fatalf("third skip transition=%+v", got)
	}
}

func TestApplyTurnEndsOnCorrectAndExhaustion(t *testing.T) {
	now := time.Now()
	base := relay.EncounterState{
		Status:       relay.EncounterStatusPlaying,
		Members:      [2]relay.PlayerSnapshot{{MemberID: "a", Seat: 1}, {MemberID: "b", Seat: 2}},
		TurnMemberID: "a", MaxTurnsPerPlayer: 1,
	}
	correct, err := relay.ApplyTurn(base, relay.Turn{Index: 1, MemberID: "a", Kind: relay.TurnKindGuess, GuessID: "answer", Correct: true}, now)
	if err != nil || !correct.Ended || correct.Reason != relay.TerminalWin || correct.WinnerMemberID == nil || *correct.WinnerMemberID != "a" {
		t.Fatalf("correct transition=%+v err=%v", correct, err)
	}

	base.Turns = []relay.Turn{{Index: 1, MemberID: "a", Kind: relay.TurnKindGuess, GuessID: "q1"}}
	base.TurnMemberID = "b"
	draw, err := relay.ApplyTurn(base, relay.Turn{Index: 2, MemberID: "b", Kind: relay.TurnKindGuess, GuessID: "q2"}, now)
	if err != nil || !draw.Ended || draw.Reason != relay.TerminalDraw || draw.WinnerMemberID != nil {
		t.Fatalf("draw transition=%+v err=%v", draw, err)
	}
}
