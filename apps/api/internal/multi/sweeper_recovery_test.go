package multi

import (
	"context"
	"errors"
	"slices"
	"testing"
)

type stubModeRecovery struct {
	roomIDs []string
	err     error
}

func (r stubModeRecovery) Sweep(context.Context, int) ([]string, error) {
	return r.roomIDs, r.err
}

type recordingBroadcaster struct {
	roomIDs []string
}

func (b *recordingBroadcaster) Publish(roomID string) {
	b.roomIDs = append(b.roomIDs, roomID)
}

func TestRunSweepStepsContinuesAfterIndependentError(t *testing.T) {
	sentinel := errors.New("recovery failed")
	called := make([]string, 0, 3)
	steps := []sweepStep{
		{name: "first", run: func(context.Context) error {
			called = append(called, "first")
			return sentinel
		}},
		{name: "second", run: func(context.Context) error {
			called = append(called, "second")
			return nil
		}},
		{name: "third", run: func(context.Context) error {
			called = append(called, "third")
			return nil
		}},
	}

	err := runSweepSteps(context.Background(), steps)
	if !errors.Is(err, sentinel) {
		t.Fatalf("error = %v, want sentinel", err)
	}
	if !slices.Equal(called, []string{"first", "second", "third"}) {
		t.Fatalf("called = %v", called)
	}
}

func TestRecoverModeUnitsPublishesPartialResultsAndContinues(t *testing.T) {
	sentinel := errors.New("candidate disappeared")
	broadcaster := &recordingBroadcaster{}
	sweeper := NewSweeper(nil, SweeperConfig{
		Broadcaster: broadcaster,
		ModeRecoveries: []ModeRecovery{
			stubModeRecovery{roomIDs: []string{"room-a"}, err: sentinel},
			stubModeRecovery{roomIDs: []string{"room-b"}},
		},
	})

	err := sweeper.recoverModeUnits(context.Background())
	if !errors.Is(err, sentinel) {
		t.Fatalf("error = %v, want sentinel", err)
	}
	if !slices.Equal(broadcaster.roomIDs, []string{"room-a", "room-b"}) {
		t.Fatalf("published rooms = %v", broadcaster.roomIDs)
	}
}
