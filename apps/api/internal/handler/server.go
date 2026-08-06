// Package handler 实现 oapi-codegen 生成的 strict server interface。
package handler

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// Server 实现 StrictServerInterface。
type Server struct {
	pool           *pgxpool.Pool
	q              *repo.Queries
	now            func() time.Time
	rng            *rand.Rand
	lobbyTTL       time.Duration  // 大厅 TTL（创建时 expires_at 基准）
	eventRetention time.Duration  // closed 保留期（关闭时 expires_at）
	joinLimiter    *ipRateLimiter // 加入/预检按 IP 限流（08 §8.5）
	timing         multi.TimingConfig // 对局时间常量（Phase 6 统一接 config）
	hub            *hub.Hub       // 实时通道（事件先入库后广播；nil 时 Publish 空转）
}

// Option 定制 Server（测试注入用）。
type Option func(*Server)

// WithJoinRateLimit 覆盖加入/预检限流参数（默认每分钟 10 次，进程内计数）。
func WithJoinRateLimit(limit int, window time.Duration) Option {
	return func(s *Server) {
		s.joinLimiter = newIPRateLimiter(limit, window)
	}
}

// WithMultiTiming 覆盖对局时间常量（集成测试注入短值）。
func WithMultiTiming(timing multi.TimingConfig) Option {
	return func(s *Server) {
		s.timing = timing
	}
}

// WithHub 注入实时通道（server.NewWithOptions 默认创建；单实例共享给 sweeper 时显式传入）。
func WithHub(h *hub.Hub) Option {
	return func(s *Server) {
		s.hub = h
	}
}

// publish 事件事务提交后广播（先入库后广播，07 §7.2；hub 未注入时空转）。
func (s *Server) publish(roomID string) {
	if s.hub != nil {
		s.hub.Publish(roomID)
	}
}

func NewServer(pool *pgxpool.Pool, opts ...Option) *Server {
	s := &Server{
		pool:           pool,
		q:              repo.New(pool),
		now:            time.Now,
		rng:            rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), uint64(time.Now().UnixNano())^0x9e3779b97f4a7c15)),
		lobbyTTL:       config.MultiLobbyTTL(),
		eventRetention: config.MultiEventRetention(),
		joinLimiter:    newIPRateLimiter(config.MultiJoinRateLimit(), time.Minute),
		timing:         multi.DefaultTimingConfig(),
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// HealthCheck 健康检查。
func (s *Server) HealthCheck(ctx context.Context, _ openapi.HealthCheckRequestObject) (openapi.HealthCheckResponseObject, error) {
	return openapi.HealthCheck200JSONResponse{Ok: true, Service: "touhouflandre-api"}, nil
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
	if request.Params.SessionId != nil {
		return s.searchSessionCharacters(ctx, *request.Params.SessionId, query, request.Params.Sort, direction, int(offset), int(limit))
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
		results = append(results, toSearchResult(character, row.SearchText, row.NameSortKey))
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

func (s *Server) searchSessionCharacters(
	ctx context.Context,
	sessionID string,
	query string,
	sortBy *openapi.CharactersSearchParamsSort,
	direction string,
	offset int,
	limit int,
) (openapi.CharactersSearchResponseObject, error) {
	session, err := s.q.GetSession(ctx, sessionID)
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

	normalizedQuery := game.NormalizeSearchText(query)
	matches := make([]game.Character, 0, len(characters))
	for _, character := range characters {
		if !character.EnabledAsGuess {
			continue
		}
		searchText := game.NormalizeSearchText(game.CharacterSearchText(character))
		if normalizedQuery == "" || strings.Contains(searchText, normalizedQuery) {
			matches = append(matches, character)
		}
	}

	sort.Slice(matches, func(i, j int) bool {
		left, right := matches[i], matches[j]
		comparison := 0
		if sortBy != nil && *sortBy == openapi.Appearance {
			comparison = left.AppearanceOrder - right.AppearanceOrder
		} else {
			comparison = strings.Compare(game.CharacterNameSortKey(left), game.CharacterNameSortKey(right))
		}
		if comparison == 0 {
			return left.ID < right.ID
		}
		if direction == "desc" {
			return comparison > 0
		}
		return comparison < 0
	})

	total := len(matches)
	if offset > total {
		offset = total
	}
	end := min(offset+limit, total)
	results := make([]openapi.CharacterSearchResult, 0, end-offset)
	for _, character := range matches[offset:end] {
		results = append(results, toSearchResult(character))
	}
	return openapi.CharactersSearch200JSONResponse{Results: results, Total: total}, nil
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

// CatalogCharacters 完整可猜角色表 + 当前版本（客户端本地搜索缓存源，08 §10.x）。
// 行表与猜测校验同一来源（enabled_as_guess）；version 供客户端检测表更新（seed 后变化）。
func (s *Server) CatalogCharacters(ctx context.Context, _ openapi.CatalogCharactersRequestObject) (openapi.CatalogCharactersResponseObject, error) {
	state, err := s.q.GetCatalogState(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ApiError{Status: http.StatusServiceUnavailable, Code: codeCatalogNotReady, Message: "题库尚未初始化，请先运行 seed。"}
		}
		return nil, internalError(err)
	}
	rows, err := s.q.ListGuessCharacters(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	characters := make([]openapi.CharacterSearchResult, 0, len(rows))
	for _, row := range rows {
		character, err := characterFromRow(row)
		if err != nil {
			return nil, internalError(err)
		}
		characters = append(characters, toSearchResult(character, row.SearchText, row.NameSortKey))
	}
	return openapi.CatalogCharacters200JSONResponse{
		Version:    state.CurrentVersion,
		Characters: characters,
	}, nil
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
