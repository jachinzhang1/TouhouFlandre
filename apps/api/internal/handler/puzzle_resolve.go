package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

type puzzleResolveFingerprint struct {
	Mode            string                    `json:"mode"`
	ResumeSessionID *string                   `json:"resumeSessionId,omitempty"`
	Difficulty      *game.QuestionDifficulty  `json:"difficulty,omitempty"`
	QuestionScope   *game.QuestionScopeConfig `json:"questionScope,omitempty"`
}

type puzzleResolveDecisionInput struct {
	Mode               string
	DateKey            string
	Difficulty         game.QuestionDifficulty
	Session            *repo.GameSession
	SessionDifficulty  game.QuestionDifficulty
	RandomScopeMatches bool
}

func shouldResumePuzzle(input puzzleResolveDecisionInput) bool {
	if input.Session == nil || input.Session.Mode != input.Mode {
		return false
	}
	if input.Mode == string(game.GameModeRandom) {
		return input.RandomScopeMatches
	}
	return input.Session.PuzzleKey.Valid &&
		input.Session.PuzzleKey.String == input.DateKey &&
		input.SessionDifficulty == input.Difficulty
}

func sameQuestionScopeRulesForResume(left, right game.QuestionScopeRules) bool {
	left = game.NormalizeQuestionScopeRules(left)
	right = game.NormalizeQuestionScopeRules(right)
	if left.TurnLimit != right.TurnLimit || left.GuessLimit != right.GuessLimit {
		return false
	}
	if len(left.FieldModes) != len(right.FieldModes) {
		return false
	}
	for key, mode := range left.FieldModes {
		if right.FieldModes[key] != mode {
			return false
		}
	}
	return true
}

func sameQuestionScopeForResume(left, right game.QuestionScopeConfig) bool {
	if left.Mode != right.Mode || left.Difficulty != right.Difficulty {
		return false
	}
	if len(left.SelectedCharacterIDs) != len(right.SelectedCharacterIDs) {
		return false
	}
	selected := make(map[string]struct{}, len(left.SelectedCharacterIDs))
	for _, id := range left.SelectedCharacterIDs {
		selected[id] = struct{}{}
	}
	for _, id := range right.SelectedCharacterIDs {
		if _, ok := selected[id]; !ok {
			return false
		}
	}
	return sameQuestionScopeRulesForResume(left.Rules, right.Rules)
}

func (s *Server) randomScopeMatches(
	ctx context.Context,
	requested *game.QuestionScopeConfig,
	stored repo.GameSession,
) (bool, error) {
	if len(stored.QuestionScope) == 0 {
		return false, nil
	}
	currentVersion, currentCharacters, currentWorks, err := s.currentCatalogWithWorks(ctx)
	if err != nil {
		return false, err
	}
	current := normalizeQuestionScopeForCatalog(
		requested,
		currentVersion,
		currentCharacters,
		currentWorks,
	).Config
	storedCharacters, err := s.charactersForVersion(ctx, stored.CatalogVersion)
	if err != nil {
		return false, err
	}
	storedInput, err := storedQuestionScopeFromJSON(stored.QuestionScope)
	if err != nil {
		return false, nil
	}
	if storedInput.CatalogVersion == "" ||
		storedInput.SchemaVersion < 1 ||
		storedInput.SchemaVersion > game.QuestionScopeSchemaVersion ||
		(storedInput.Mode != game.QuestionScopeModePreset &&
			storedInput.Mode != game.QuestionScopeModeCustom) ||
		(storedInput.Difficulty != game.QuestionDifficultyCustom &&
			!game.IsQuestionDifficultyPreset(storedInput.Difficulty)) ||
		len(storedInput.SelectedCharacterIDs) == 0 {
		return false, nil
	}
	storedScope := normalizeQuestionScopeForCatalog(
		&storedInput,
		stored.CatalogVersion,
		storedCharacters,
		nil,
	).Config
	return sameQuestionScopeForResume(current, storedScope), nil
}

func normalizedResolveFingerprint(
	mode string,
	resumeSessionID *string,
	difficulty game.QuestionDifficulty,
	requestedScope *game.QuestionScopeConfig,
) (string, error) {
	input := puzzleResolveFingerprint{Mode: mode, ResumeSessionID: resumeSessionID}
	if mode == string(game.GameModeDaily) {
		input.Difficulty = &difficulty
	} else {
		input.QuestionScope = requestedScope
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func puzzleLabelForSession(definition game.SinglePlayerModeDefinition, session openapi.PublicGameSession) string {
	if session.Mode == openapi.GameModeDaily && session.PuzzleKey != nil {
		return definition.Label + " " + *session.PuzzleKey
	}
	return definition.PuzzleLabel
}

func (s *Server) publicSession(ctx context.Context, stored repo.GameSession) (openapi.PublicGameSession, error) {
	characters, err := s.charactersForVersion(ctx, stored.CatalogVersion)
	if err != nil {
		return openapi.PublicGameSession{}, err
	}
	public, err := toPublicSession(stored, characters)
	if err != nil {
		return openapi.PublicGameSession{}, internalError(err)
	}
	return public, nil
}

func (s *Server) storedResolveResponse(
	ctx context.Context,
	definition game.SinglePlayerModeDefinition,
	record repo.PuzzleResolveIdempotency,
) (openapi.PuzzleResolveResponse, error) {
	if !record.SessionID.Valid || !record.Resolution.Valid {
		return openapi.PuzzleResolveResponse{}, internalError(errors.New("incomplete puzzle resolve idempotency record"))
	}
	stored, err := s.q.GetSession(ctx, record.SessionID.String)
	if err != nil {
		return openapi.PuzzleResolveResponse{}, internalError(err)
	}
	public, err := s.publicSession(ctx, stored)
	if err != nil {
		return openapi.PuzzleResolveResponse{}, err
	}
	result := openapi.PuzzleResolveResponse{
		PuzzleLabel: puzzleLabelForSession(definition, public),
		Resolution:  openapi.PuzzleResolution(record.Resolution.String),
		Session:     public,
	}
	if record.SupersededSessionID.Valid {
		superseded, err := s.q.GetSession(ctx, record.SupersededSessionID.String)
		if err != nil {
			return openapi.PuzzleResolveResponse{}, internalError(err)
		}
		projected, err := s.publicSession(ctx, superseded)
		if err != nil {
			return openapi.PuzzleResolveResponse{}, err
		}
		result.SupersededSession = &projected
	}
	return result, nil
}

func resolveRecordExpired(record repo.PuzzleResolveIdempotency, now time.Time) bool {
	return record.ExpiresAt.Valid &&
		record.ExpiresAt.InfinityModifier == pgtype.Finite &&
		!record.ExpiresAt.Time.After(now)
}

func (s *Server) resolvePuzzleInTransaction(
	ctx context.Context,
	mode string,
	definition game.SinglePlayerModeDefinition,
	resumeSessionID *string,
	difficulty game.QuestionDifficulty,
	requestedScope *game.QuestionScopeConfig,
) (openapi.PuzzleResolveResponse, error) {
	dateKey := game.GetPuzzleDateKey(s.now(), nil)
	var superseded *repo.GameSession
	if resumeSessionID != nil {
		stored, err := s.q.GetSessionForUpdate(ctx, *resumeSessionID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return openapi.PuzzleResolveResponse{}, internalError(err)
		}
		if err == nil {
			sessionDifficulty := game.QuestionDifficulty("")
			randomScopeMatches := false
			if mode == string(game.GameModeDaily) && stored.Mode == mode {
				characters, charactersErr := s.charactersForVersion(ctx, stored.CatalogVersion)
				if charactersErr != nil {
					return openapi.PuzzleResolveResponse{}, charactersErr
				}
				scope, scopeErr := questionScopeFromJSON(stored.QuestionScope, stored.CatalogVersion, nil, characters)
				if scopeErr != nil {
					return openapi.PuzzleResolveResponse{}, internalError(scopeErr)
				}
				sessionDifficulty = scope.Difficulty
			}
			if mode == string(game.GameModeRandom) && stored.Mode == mode {
				var scopeErr error
				randomScopeMatches, scopeErr = s.randomScopeMatches(ctx, requestedScope, stored)
				if scopeErr != nil {
					return openapi.PuzzleResolveResponse{}, internalError(scopeErr)
				}
			}
			if shouldResumePuzzle(puzzleResolveDecisionInput{
				Mode: mode, DateKey: dateKey, Difficulty: difficulty,
				Session: &stored, SessionDifficulty: sessionDifficulty,
				RandomScopeMatches: randomScopeMatches,
			}) {
				public, publicErr := s.publicSession(ctx, stored)
				if publicErr != nil {
					return openapi.PuzzleResolveResponse{}, publicErr
				}
				return openapi.PuzzleResolveResponse{
					PuzzleLabel: puzzleLabelForSession(definition, public),
					Resolution:  openapi.Resumed,
					Session:     public,
				}, nil
			}
			superseded = &stored
		}
	}

	selection, err := s.selectAnswer(ctx, mode, definition, requestedScope, difficulty)
	if err != nil {
		return openapi.PuzzleResolveResponse{}, err
	}
	created, err := s.createSession(ctx, mode, definition, selection)
	if err != nil {
		return openapi.PuzzleResolveResponse{}, err
	}
	result := openapi.PuzzleResolveResponse{
		PuzzleLabel: puzzleLabelForSession(definition, created),
		Resolution:  openapi.Created,
		Session:     created,
	}
	if superseded != nil {
		public, publicErr := s.publicSession(ctx, *superseded)
		if publicErr != nil {
			return openapi.PuzzleResolveResponse{}, publicErr
		}
		result.SupersededSession = &public
	}
	return result, nil
}

// PuzzlesResolve atomically restores a compatible session or creates a new one.
func (s *Server) PuzzlesResolve(ctx context.Context, request openapi.PuzzlesResolveRequestObject) (openapi.PuzzlesResolveResponseObject, error) {
	mode := string(request.Mode)
	definition := game.SinglePlayerModeDefinitions[mode]
	if definition.ID == "" || request.Body == nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "请求格式不正确。"}
	}
	idempotencyKey := strings.TrimSpace(request.Body.IdempotencyKey)
	if idempotencyKey == "" || len(idempotencyKey) > 200 {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "幂等键不合法。"}
	}
	var resumeSessionID *string
	if request.Body.ResumeSessionId != nil {
		trimmed := strings.TrimSpace(*request.Body.ResumeSessionId)
		if trimmed != "" {
			resumeSessionID = &trimmed
		}
	}
	difficulty := game.QuestionDifficultyNormal
	if request.Body.Difficulty != nil {
		difficulty = game.QuestionDifficulty(*request.Body.Difficulty)
	}
	if mode == string(game.GameModeDaily) && !game.IsDailyQuestionDifficulty(difficulty) {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "每日题难度不合法。"}
	}
	requestedScope := questionScopeFromOpenAPI(request.Body.QuestionScope)
	fingerprint, err := normalizedResolveFingerprint(mode, resumeSessionID, difficulty, requestedScope)
	if err != nil {
		return nil, internalError(err)
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	txServer := *s
	txServer.q = repo.New(tx)
	_, insertErr := txServer.q.InsertPuzzleResolveIdempotency(ctx, repo.InsertPuzzleResolveIdempotencyParams{
		IdempotencyKey: idempotencyKey, RequestFingerprint: fingerprint, Mode: mode,
	})
	inserted := insertErr == nil
	if insertErr != nil && !errors.Is(insertErr, pgx.ErrNoRows) {
		return nil, internalError(insertErr)
	}
	record, err := txServer.q.GetPuzzleResolveIdempotencyForUpdate(ctx, idempotencyKey)
	if err != nil {
		return nil, internalError(err)
	}
	if !inserted && resolveRecordExpired(record, s.now()) {
		if err := txServer.q.ReuseExpiredPuzzleResolveIdempotency(ctx, repo.ReuseExpiredPuzzleResolveIdempotencyParams{
			RequestFingerprint: fingerprint, Mode: mode, IdempotencyKey: idempotencyKey,
		}); err != nil {
			return nil, internalError(err)
		}
		record, err = txServer.q.GetPuzzleResolveIdempotencyForUpdate(ctx, idempotencyKey)
		if err != nil {
			return nil, internalError(err)
		}
		inserted = true
	}
	if record.RequestFingerprint != fingerprint {
		return nil, &ApiError{Status: http.StatusConflict, Code: codeIdempotencyKeyReused, Message: "这个幂等键已用于其他题局请求。"}
	}
	if !inserted {
		stored, storedErr := txServer.storedResolveResponse(ctx, definition, record)
		if storedErr != nil {
			return nil, storedErr
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError(err)
		}
		return openapi.PuzzlesResolve200JSONResponse(stored), nil
	}

	result, err := txServer.resolvePuzzleInTransaction(ctx, mode, definition, resumeSessionID, difficulty, requestedScope)
	if err != nil {
		return nil, err
	}
	var supersededID pgtype.Text
	if result.SupersededSession != nil {
		supersededID = pgtype.Text{String: result.SupersededSession.Id, Valid: true}
	}
	if err := txServer.q.CompletePuzzleResolveIdempotency(ctx, repo.CompletePuzzleResolveIdempotencyParams{
		SessionID:           pgtype.Text{String: result.Session.Id, Valid: true},
		Resolution:          pgtype.Text{String: string(result.Resolution), Valid: true},
		SupersededSessionID: supersededID,
		IdempotencyKey:      idempotencyKey,
	}); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	return openapi.PuzzlesResolve200JSONResponse(result), nil
}
