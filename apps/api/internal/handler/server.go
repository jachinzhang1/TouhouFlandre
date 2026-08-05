// Package handler 实现 oapi-codegen 生成的 strict server interface。
package handler

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// Server 实现 StrictServerInterface。
type Server struct {
	pool *pgxpool.Pool
	q    *repo.Queries
	now  func() time.Time
	rng  *rand.Rand
}

func NewServer(pool *pgxpool.Pool) *Server {
	return &Server{
		pool: pool,
		q:    repo.New(pool),
		now:  time.Now,
		rng:  rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// HealthCheck 健康检查。
func (s *Server) HealthCheck(ctx context.Context, _ openapi.HealthCheckRequestObject) (openapi.HealthCheckResponseObject, error) {
	return openapi.HealthCheck200JSONResponse{Ok: true, Service: "touhoufriberg-api"}, nil
}

// CharactersSearch 搜索角色（行表 + ILIKE）。
func (s *Server) CharactersSearch(ctx context.Context, request openapi.CharactersSearchRequestObject) (openapi.CharactersSearchResponseObject, error) {
	query := ""
	if request.Params.Q != nil {
		query = *request.Params.Q
	}
	limit := int32(50)
	if request.Params.Limit != nil {
		limit = int32(*request.Params.Limit)
	}
	offset := int32(0)
	if request.Params.Offset != nil {
		offset = int32(*request.Params.Offset)
	}
	direction := "asc"
	if request.Params.Direction != nil {
		direction = string(*request.Params.Direction)
	}

	var rows []repo.Character
	var err error
	if request.Params.Sort != nil && *request.Params.Sort == openapi.Appearance {
		rows, err = s.q.SearchCharactersByAppearance(ctx, repo.SearchCharactersByAppearanceParams{
			Q: query, Direction: direction, PageOffset: offset, MaxResults: limit,
		})
	} else {
		rows, err = s.q.SearchCharactersByName(ctx, repo.SearchCharactersByNameParams{
			Q: query, Direction: direction, PageOffset: offset, MaxResults: limit,
		})
	}
	if err != nil {
		return nil, internalError(err)
	}

	results := make([]openapi.CharacterSearchResult, 0, len(rows))
	for _, row := range rows {
		character, err := characterFromRow(row)
		if err != nil {
			return nil, internalError(err)
		}
		results = append(results, toSearchResult(character))
	}

	total, err := s.q.CountSearchCharacters(ctx, query)
	if err != nil {
		return nil, internalError(err)
	}
	return openapi.CharactersSearch200JSONResponse{
		Results: results,
		Total:   int(total),
	}, nil
}

// CatalogGet 题库摘要；题库未初始化时返回 503。
func (s *Server) CatalogGet(ctx context.Context, _ openapi.CatalogGetRequestObject) (openapi.CatalogGetResponseObject, error) {
	if _, err := s.q.GetCatalogState(ctx); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ApiError{Status: http.StatusServiceUnavailable, Code: codeCatalogNotReady, Message: "题库尚未初始化，请先运行 seed。"}
		}
		return nil, internalError(err)
	}
	counts, err := s.q.GetCatalogCounts(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	definition := game.GameContentDefinition
	visibleFieldCount := 0
	for _, field := range definition.Fields {
		if field.Visible {
			visibleFieldCount++
		}
	}
	summary := openapi.CatalogSummary{
		DailyDateKey: game.GetPuzzleDateKey(s.now(), nil),
		Contents: []openapi.CatalogContentSummary{{
			ContentType:       openapi.GameContentType(game.GameContentCharacter),
			Label:             definition.Label,
			Total:             int(counts.Total),
			Guessable:         int(counts.Guessable),
			Answerable:        int(counts.Answerable),
			MaxGuesses:        definition.MaxGuesses,
			VisibleFieldCount: visibleFieldCount,
		}},
	}
	return openapi.CatalogGet200JSONResponse(summary), nil
}

// PuzzlesCreate 创建题局（每日题或随机）。
func (s *Server) PuzzlesCreate(ctx context.Context, request openapi.PuzzlesCreateRequestObject) (openapi.PuzzlesCreateResponseObject, error) {
	definition := game.SinglePlayerModeDefinitions[string(request.Mode)]
	if definition.ID == "" {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "不支持的模式。"}
	}
	selection, err := s.selectAnswer(ctx, string(request.Mode), definition)
	if err != nil {
		return nil, err
	}
	session, err := s.createSession(ctx, string(request.Mode), definition, selection)
	if err != nil {
		return nil, err
	}
	puzzleLabel := definition.PuzzleLabel
	if string(request.Mode) == "daily" && selection.puzzleKey != nil {
		puzzleLabel = definition.Label + " " + *selection.puzzleKey
	}
	return openapi.PuzzlesCreate200JSONResponse(openapi.PuzzleResponse{
		PuzzleLabel: puzzleLabel,
		Session:     session,
	}), nil
}

// SessionsGet 恢复会话。
func (s *Server) SessionsGet(ctx context.Context, request openapi.SessionsGetRequestObject) (openapi.SessionsGetResponseObject, error) {
	session, err := s.q.GetSession(ctx, request.SessionId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ApiError{Status: http.StatusNotFound, Code: codeSessionNotFound, Message: "没有找到这一局游戏。"}
		}
		return nil, internalError(err)
	}
	characters, err := s.charactersForVersion(ctx, session.CatalogVersion)
	if err != nil {
		return nil, err
	}
	public, err := toPublicSession(session, characters)
	if err != nil {
		return nil, internalError(err)
	}
	return openapi.SessionsGet200JSONResponse{Session: public}, nil
}

// SessionsSubmitGuess 提交猜测（乐观锁重试两次）。
func (s *Server) SessionsSubmitGuess(ctx context.Context, request openapi.SessionsSubmitGuessRequestObject) (openapi.SessionsSubmitGuessResponseObject, error) {
	if request.Body == nil || request.Body.GuessId == "" {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "请求格式不正确。"}
	}
	guessID := request.Body.GuessId

	for attempt := 0; attempt < 2; attempt++ {
		session, err := s.q.GetSession(ctx, request.SessionId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &ApiError{Status: http.StatusNotFound, Code: codeSessionNotFound, Message: "没有找到这一局游戏。"}
			}
			return nil, internalError(err)
		}
		if session.Status != string(game.SessionPlaying) {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeSessionClosed, Message: "这一局已经结束。"}
		}

		var guesses []game.GuessResult
		if err := jsonUnmarshal(session.Guesses, &guesses); err != nil {
			return nil, internalError(err)
		}
		for _, entry := range guesses {
			if entry.GuessID == guessID {
				return nil, &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "这个角色已经猜过了。"}
			}
		}

		characters, err := s.charactersForVersion(ctx, session.CatalogVersion)
		if err != nil {
			return nil, err
		}
		if session.ContentType != string(game.GameContentCharacter) {
			return nil, &ApiError{Status: http.StatusNotImplemented, Code: codeUnsupportedContentType, Message: fmt.Sprintf("暂不支持 %s 类型的猜测。", session.ContentType)}
		}
		var guess, answer *game.Character
		for i := range characters {
			if characters[i].ID == guessID && characters[i].EnabledAsGuess {
				guess = &characters[i]
			}
			if characters[i].ID == session.AnswerID {
				answer = &characters[i]
			}
		}
		if guess == nil {
			return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidGuess, Message: "请选择本局题库中的角色。"}
		}
		if answer == nil {
			return nil, &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: "本局题库快照中缺少答案角色。"}
		}

		result := game.CompareCharacter(*guess, *answer, nil)
		nextGuesses := append(guesses, result)
		nextStatus := game.SessionPlaying
		if result.IsCorrect {
			nextStatus = game.SessionWon
		} else if len(nextGuesses) >= int(session.MaxGuesses) {
			nextStatus = game.SessionLost
		}

		var endedAt *time.Time
		if nextStatus != game.SessionPlaying {
			now := s.now().UTC()
			endedAt = &now
		}
		guessesJSON, err := jsonMarshal(nextGuesses)
		if err != nil {
			return nil, internalError(err)
		}
		var endedAtValue pgtype.Timestamptz
		if endedAt != nil {
			endedAtValue = pgtype.Timestamptz{Time: *endedAt, Valid: true}
		}

		updated, err := s.q.UpdateSessionGuess(ctx, repo.UpdateSessionGuessParams{
			ID:      session.ID,
			Version: session.Version,
			Guesses: guessesJSON,
			Status:  string(nextStatus),
			EndedAt: endedAtValue,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue // 版本冲突，重试
			}
			return nil, internalError(err)
		}
		public, err := toPublicSession(updated, characters)
		if err != nil {
			return nil, internalError(err)
		}
		return openapi.SessionsSubmitGuess200JSONResponse{Session: public}, nil
	}

	return nil, &ApiError{Status: http.StatusConflict, Code: codeConcurrentUpdate, Message: "会话刚刚发生变化，请重新提交。"}
}
