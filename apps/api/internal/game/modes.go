package game

// SinglePlayerModeDefinition 对应 shared 的 SinglePlayerModeDefinition。
type SinglePlayerModeDefinition struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	PuzzleLabel  string `json:"puzzleLabel"`
	ContentType  string `json:"contentType"`
}

// SinglePlayerModeDefinitions 对应 shared 的 SINGLE_PLAYER_MODE_DEFINITIONS。
var SinglePlayerModeDefinitions = map[string]SinglePlayerModeDefinition{
	"daily": {
		ID:          "daily",
		Label:       "每日题",
		PuzzleLabel: "今日每日题",
		ContentType: "character",
	},
	"random": {
		ID:          "random",
		Label:       "随机题",
		PuzzleLabel: "随机题",
		ContentType: "character",
	},
}

// IsSinglePlayerGameMode 对应 shared 的 isSinglePlayerGameMode。
func IsSinglePlayerGameMode(value string) bool {
	_, ok := SinglePlayerModeDefinitions[value]
	return ok
}
