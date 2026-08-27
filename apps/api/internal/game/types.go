// Package game 承载服务端权威游戏逻辑，由 packages/shared 平移而来。
package game

// FeedbackStatus 对应 shared 的 FEEDBACK_STATUSES。
type FeedbackStatus string

const (
	FeedbackExact   FeedbackStatus = "exact"
	FeedbackPartial FeedbackStatus = "partial"
	FeedbackMiss    FeedbackStatus = "miss"
	FeedbackHigher  FeedbackStatus = "higher"
	FeedbackLower   FeedbackStatus = "lower"
	FeedbackUnknown FeedbackStatus = "unknown"
)

// GuessFieldKey 对应 shared 的 GUESS_FIELD_KEYS。
type GuessFieldKey string

const (
	FieldFirstAppearance GuessFieldKey = "firstAppearance"
	FieldReleaseYear     GuessFieldKey = "releaseYear"
	FieldSpecies         GuessFieldKey = "species"
	FieldAbilityTags     GuessFieldKey = "abilityTags"
	FieldAffiliations    GuessFieldKey = "affiliations"
	FieldLocations       GuessFieldKey = "locations"
	FieldRoles           GuessFieldKey = "roles"
	FieldHairColors      GuessFieldKey = "hairColors"
)

// GuessField 对应 shared 的 GuessField。
type GuessField struct {
	Key             GuessFieldKey `json:"key"`
	Label           string        `json:"label"`
	Type            string        `json:"type"`
	Visible         bool          `json:"visible"`
	CompareStrategy string        `json:"compareStrategy"`
	HelpText        string        `json:"helpText,omitempty"`
}

type GuessFieldModeDefinition struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
}

// GuessFieldDefinition describes one configurable public feedback field.
// Comparison and canonicalization functions remain server-owned.
type GuessFieldDefinition struct {
	Key          GuessFieldKey              `json:"key"`
	Label        string                     `json:"label"`
	Type         string                     `json:"type"`
	HelpText     string                     `json:"helpText,omitempty"`
	Configurable bool                       `json:"configurable"`
	DefaultMode  string                     `json:"defaultMode"`
	Modes        []GuessFieldModeDefinition `json:"modes"`
	Equivalence  bool                       `json:"equivalence"`
}

type MatchKind string

const (
	MatchNone       MatchKind = "none"
	MatchExact      MatchKind = "exact"
	MatchEquivalent MatchKind = "equivalent"
)

// FieldFeedback 对应 shared 的 FieldFeedback。
type FieldFeedback struct {
	Field        GuessFieldKey  `json:"field"`
	Label        string         `json:"label"`
	Status       FeedbackStatus `json:"status"`
	Symbol       string         `json:"symbol"`
	DisplayValue []string       `json:"displayValue"`
}

// GuessResult 对应 shared 的 GuessResult。
type GuessResult struct {
	Kind           string          `json:"kind,omitempty"`
	GuessID        string          `json:"guessId"`
	GuessName      string          `json:"guessName"`
	GuessAvatarURL string          `json:"guessAvatarUrl,omitempty"`
	IsCorrect      bool            `json:"isCorrect"`
	MatchKind      MatchKind       `json:"matchKind"`
	Feedback       []FieldFeedback `json:"feedback"`
}

// LocalizedNames 对应 shared 的 LocalizedNames。
type LocalizedNames struct {
	ZhHans  string   `json:"zhHans"`
	ZhHant  *string  `json:"zhHant,omitempty"`
	Ja      string   `json:"ja"`
	En      string   `json:"en"`
	Romaji  *string  `json:"romaji,omitempty"`
	Aliases []string `json:"aliases"`
}

// FirstAppearance 对应 shared 的 FirstAppearance。
type FirstAppearance struct {
	WorkID             string   `json:"workId"`
	WorkTitle          string   `json:"workTitle"`
	WorkType           string   `json:"workType"`
	ReleaseYear        int      `json:"releaseYear"`
	MainlineIndex      *int     `json:"mainlineIndex,omitempty"`
	Era                *string  `json:"era,omitempty"`
	WorkPinyinInitials []string `json:"workPinyinInitials,omitempty"`
}

// Character 对应 shared 的 Character。
// 注意：字段顺序必须与 packages/data/src/index.ts 组装后的对象键序一致
// （id, avatarUrl, names, firstAppearance, …, appearanceOrder），
// 因为 catalog 版本号 = FNV-1a(JSON 序列化)，键序影响哈希。
type Character struct {
	ID              string          `json:"id"`
	AvatarURL       string          `json:"avatarUrl"`
	Names           LocalizedNames  `json:"names"`
	FirstAppearance FirstAppearance `json:"firstAppearance"`
	Species         []string        `json:"species"`
	AbilityDisplay  string          `json:"abilityDisplay"`
	AbilityTags     []string        `json:"abilityTags"`
	Affiliations    []string        `json:"affiliations"`
	Locations       []string        `json:"locations"`
	Roles           []string        `json:"roles"`
	HairColors      []string        `json:"hairColors"`
	Playable        bool            `json:"playable"`
	EnabledAsAnswer bool            `json:"enabledAsAnswer"`
	EnabledAsGuess  bool            `json:"enabledAsGuess"`
	DifficultyTier  string          `json:"difficultyTier"`
	SourceRefs      []string        `json:"sourceRefs"`
	AppearanceOrder int             `json:"appearanceOrder"`
}

// GameContentType 对应 shared 的 GameContentType。
type GameContentType string

const GameContentCharacter GameContentType = "character"

// GameMode 对应 shared 的 GameMode。
type GameMode string

const (
	GameModeDaily       GameMode = "daily"
	GameModeRandom      GameMode = "random"
	GameModeMultiplayer GameMode = "multiplayer"
)

// SessionStatus 对应 shared 的 SESSION_STATUSES。
type SessionStatus string

const (
	SessionPlaying SessionStatus = "playing"
	SessionWon     SessionStatus = "won"
	SessionLost    SessionStatus = "lost"
)
