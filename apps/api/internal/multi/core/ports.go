package core

import (
	cryptorand "crypto/rand"
	"encoding/binary"
	"math/rand/v2"
	"sync"
	"time"
)

type Clock interface {
	Now() time.Time
}

type ClockFunc func() time.Time

func (f ClockFunc) Now() time.Time { return f() }

type SystemClock struct{}

func (SystemClock) Now() time.Time { return time.Now() }

// RandomSource is the narrow random port used by match creation and rules.
type RandomSource interface {
	IntN(int) int
}

type lockedRandom struct {
	mu  sync.Mutex
	rng *rand.Rand
}

func (r *lockedRandom) IntN(n int) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rng.IntN(n)
}

func NewRandomSource() RandomSource {
	var seed [16]byte
	if _, err := cryptorand.Read(seed[:]); err != nil {
		panic("multi core: crypto/rand unavailable: " + err.Error())
	}
	return &lockedRandom{rng: rand.New(rand.NewPCG(
		binary.LittleEndian.Uint64(seed[:8]),
		binary.LittleEndian.Uint64(seed[8:]),
	))}
}

type RoomConfig struct {
	Mode                   Mode
	PlayerLimit            int
	PlayerLimitSpecified   bool
	RaceEliminationEnabled bool
	TurnSeconds            int
}

type RosterMember struct {
	Connected bool
	Ready     bool
	Player    bool
	Seat      int
}

type RoomPolicy interface {
	PrepareRoom(RoomConfig) (RoomConfig, error)
	ReadyRoster([]RosterMember, int) bool
}

type MatchPlanInput struct {
	Mode                   Mode
	Format                 string
	RosterSize             int
	RaceEliminationEnabled bool
	MaxRoundsFactor        int
	Now                    time.Time
	RoundCountdown         time.Duration
	RoundSeconds           time.Duration
	RaceRoundSeconds       time.Duration
	TurnSeconds            int
}

type MatchPlan struct {
	RuleSet            RuleSetRef
	ScoringMode        string
	RuleConfigSnapshot []byte
	TargetWins         int
	MaxRounds          int
	StartsAt           time.Time
	Deadline           time.Time
	FirstTurnSeat      *int
	TurnDeadline       *time.Time
}

type MatchFactory interface {
	Plan(MatchPlanInput) (MatchPlan, error)
}

type RuleSetParser interface {
	ParseLegacy(string) (RuleSetRef, error)
}

type CommandName string

const (
	CommandGuess   CommandName = "guess"
	CommandPass    CommandName = "pass"
	CommandForfeit CommandName = "forfeit"
)

type CommandContext struct {
	RuleSet RuleSetRef
	Command CommandName
	ActorID string
	Now     time.Time
}

type CommandRoute string

const (
	CommandRouteRace        CommandRoute = "race"
	CommandRouteLegacyRelay CommandRoute = "legacy_relay"
)

type CommandResult struct {
	Route    CommandRoute
	Accepted bool
}

type CommandHandler interface {
	Handle(CommandContext) (CommandResult, error)
}

type CompletionRoute string

const (
	CompletionRouteRace        CompletionRoute = "race"
	CompletionRouteLegacyRelay CompletionRoute = "legacy_relay"
)

type CompletionDriver interface {
	Route(RuleSetRef) (CompletionRoute, error)
}

type ProjectionStyle string

const (
	ProjectionRaceAnonymous ProjectionStyle = "race_anonymous"
	ProjectionRelayShared   ProjectionStyle = "relay_shared"
)

type SnapshotProjector interface {
	Style(RuleSetRef) (ProjectionStyle, error)
}

type HistoryReader interface {
	Style(RuleSetRef) (ProjectionStyle, error)
}

type RecoveryRoute string

const (
	RecoveryRouteRace        RecoveryRoute = "race"
	RecoveryRouteLegacyRelay RecoveryRoute = "legacy_relay"
	RecoveryRouteModeOwned   RecoveryRoute = "mode_owned"
)

type RecoveryDriver interface {
	Route(RuleSetRef) (RecoveryRoute, error)
}
