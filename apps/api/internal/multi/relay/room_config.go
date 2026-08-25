package relay

// RoomConfig is the relay-owned room preference. It is intentionally kept
// separate from race configuration because the same boolean selects different
// rule sets and only applies to rosters larger than two.
type RoomConfig struct {
	EliminationEnabled bool
}
