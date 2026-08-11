package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func jsonUnmarshal(data []byte, target any) error {
	return json.Unmarshal(data, target)
}

func jsonMarshal(value any) ([]byte, error) {
	return json.Marshal(value)
}

// newSessionID 生成 25 位小写字母数字 id（crypto/rand，cuid 形态兼容）。
func newSessionID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	raw := make([]byte, 25)
	if _, err := rand.Read(raw); err != nil {
		panic("handler: crypto/rand unavailable: " + err.Error())
	}
	id := make([]byte, 25)
	for i, b := range raw {
		id[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(id)
}

// answerSelection 答案选择结果。
type answerSelection struct {
	answer         game.Character
	catalogVersion string
	puzzleKey      *string
	questionScope  game.QuestionScopeConfig
}

// getCurrentCatalog 对应 game.ts 的 getCurrentCatalog。
func (s *Server) getCurrentCatalog(ctx context.Context) (string, []game.Character, error) {
	state, err := s.q.GetCatalogState(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, &ApiError{Status: http.StatusServiceUnavailable, Code: codeCatalogNotReady, Message: "题库尚未初始化，请先运行 seed。"}
		}
		return "", nil, internalError(err)
	}
	characters, err := s.charactersForVersion(ctx, state.CurrentVersion)
	if err != nil {
		return "", nil, err
	}
	return state.CurrentVersion, characters, nil
}

// charactersForVersion 按版本读取快照角色（解析逻辑在 multi.CharactersForVersion）。
func (s *Server) charactersForVersion(ctx context.Context, version string) ([]game.Character, error) {
	characters, err := multi.CharactersForVersion(ctx, s.q, version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: "题库快照缺失：" + version}
		}
		return nil, internalError(err)
	}
	return characters, nil
}

// getOrCreateDailyPuzzle 对应 game.ts 的 getOrCreateDailyPuzzle。
func (s *Server) getOrCreateDailyPuzzle(ctx context.Context, dateKey string, difficulty game.QuestionDifficulty, scope game.QuestionScopeConfig) (game.Character, string, error) {
	existing, err := s.q.GetDailyPuzzle(ctx, repo.GetDailyPuzzleParams{DateKey: dateKey, Difficulty: string(difficulty)})
	if err == nil {
		characters, err := s.charactersForVersion(ctx, existing.CatalogVersion)
		if err != nil {
			return game.Character{}, "", err
		}
		var answer *game.Character
		for i := range characters {
			if characters[i].ID == existing.AnswerID {
				answer = &characters[i]
				break
			}
		}
		if answer == nil {
			return game.Character{}, "", &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: "每日题快照中缺少答案角色。"}
		}
		return *answer, existing.CatalogVersion, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return game.Character{}, "", internalError(err)
	}

	version, characters, err := s.getCurrentCatalog(ctx)
	if err != nil {
		return game.Character{}, "", err
	}
	pool := charactersForQuestionScope(characters, scope)
	answer, err := game.GetDailyAnswerFromPool(pool, dateKey+":"+string(difficulty))
	if err != nil {
		return game.Character{}, "", &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: err.Error()}
	}
	if _, err := s.q.CreateDailyPuzzle(ctx, repo.CreateDailyPuzzleParams{
		DateKey:        dateKey,
		Difficulty:     string(difficulty),
		CatalogVersion: version,
		AnswerID:       answer.ID,
	}); err != nil {
		// 并发创建冲突时重读已有记录。
		if isUniqueViolation(err) {
			return s.getOrCreateDailyPuzzle(ctx, dateKey, difficulty, scope)
		}
		return game.Character{}, "", internalError(err)
	}
	return answer, version, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// selectAnswer 按模式选择答案。
func (s *Server) selectAnswer(ctx context.Context, mode string, definition game.SinglePlayerModeDefinition, requestedScope *game.QuestionScopeConfig, dailyDifficulty game.QuestionDifficulty) (answerSelection, error) {
	version, characters, works, err := s.currentCatalogWithWorks(ctx)
	if err != nil {
		return answerSelection{}, err
	}
	scopeInput := requestedScope
	if mode == string(game.GameModeDaily) {
		if !game.IsQuestionDifficultyPreset(dailyDifficulty) {
			dailyDifficulty = game.QuestionDifficultyNormal
		}
		preset := game.DefaultQuestionScope(version, questionScopeWorks(works), characters, dailyDifficulty)
		scopeInput = &preset
		scope := normalizeQuestionScopeForCatalog(scopeInput, version, characters, works).Config
		dateKey := game.GetPuzzleDateKey(s.now(), nil)
		answer, version, err := s.getOrCreateDailyPuzzle(ctx, dateKey, dailyDifficulty, scope)
		if err != nil {
			return answerSelection{}, err
		}
		if version != scope.CatalogVersion {
			dailyCharacters, err := s.charactersForVersion(ctx, version)
			if err != nil {
				return answerSelection{}, err
			}
			scope = game.DefaultQuestionScope(version, questionScopeWorksForSnapshot(nil, dailyCharacters), dailyCharacters, dailyDifficulty)
		}
		return answerSelection{answer: answer, catalogVersion: version, puzzleKey: &dateKey, questionScope: scope}, nil
	}
	scope := normalizeQuestionScopeForCatalog(scopeInput, version, characters, works).Config
	pool := charactersForQuestionScope(characters, scope)
	if len(pool) == 0 {
		return answerSelection{}, &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: "题库中没有可作为答案的角色。"}
	}
	answer := pool[s.rng.IntN(len(pool))]
	return answerSelection{answer: answer, catalogVersion: version, questionScope: scope}, nil
}

// createSession 对应 game.ts 的 createSession。
func (s *Server) createSession(ctx context.Context, mode string, definition game.SinglePlayerModeDefinition, selection answerSelection) (openapi.PublicGameSession, error) {
	var puzzleKey pgtype.Text
	if selection.puzzleKey != nil {
		puzzleKey = pgtype.Text{String: *selection.puzzleKey, Valid: true}
	}
	maxGuesses := game.GameContentDefinition.MaxGuesses
	if mode != string(game.GameModeDaily) {
		maxGuesses = game.EffectiveQuestionScopeMaxGuesses(selection.questionScope.Rules)
	}
	created, err := s.q.CreateSession(ctx, repo.CreateSessionParams{
		ID:             newSessionID(),
		Mode:           mode,
		ContentType:    definition.ContentType,
		AnswerID:       selection.answer.ID,
		CatalogVersion: selection.catalogVersion,
		PuzzleKey:      puzzleKey,
		Status:         string(game.SessionPlaying),
		MaxGuesses:     int32(maxGuesses),
		QuestionScope:  mustQuestionScopeJSON(selection.questionScope),
	})
	if err != nil {
		return openapi.PublicGameSession{}, internalError(err)
	}
	characters, err := s.charactersForVersion(ctx, selection.catalogVersion)
	if err != nil {
		return openapi.PublicGameSession{}, err
	}
	public, err := toPublicSession(created, characters)
	if err != nil {
		return openapi.PublicGameSession{}, internalError(err)
	}
	return public, nil
}

func charactersForQuestionScope(characters []game.Character, scope game.QuestionScopeConfig) []game.Character {
	selected := map[string]bool{}
	for _, id := range scope.SelectedCharacterIDs {
		selected[id] = true
	}
	pool := make([]game.Character, 0, len(scope.SelectedCharacterIDs))
	for _, character := range characters {
		if character.EnabledAsAnswer && selected[character.ID] {
			pool = append(pool, character)
		}
	}
	return pool
}

func mustQuestionScopeJSON(scope game.QuestionScopeConfig) []byte {
	data, err := questionScopeJSON(scope)
	if err != nil {
		panic("handler: invalid question scope: " + err.Error())
	}
	return data
}
