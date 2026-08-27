// Package handler 实现 oapi-codegen 生成的 strict server interface。
package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

// Server 实现 StrictServerInterface。
type Server struct {
	pool              *pgxpool.Pool
	q                 *repo.Queries
	now               func() time.Time
	rng               core.RandomSource
	modeRegistry      *core.Registry
	relayCoordinator  *relaydomain.StageCoordinator
	relayEncounters   *relayadapter.EncounterService
	lobbyTTL          time.Duration      // 大厅 TTL（创建时 expires_at 基准）
	eventRetention    time.Duration      // closed 保留期（关闭时 expires_at）
	joinLimiter       *ipRateLimiter     // 加入/预检按 IP 限流（08 §8.5）
	historyLimiter    *ipRateLimiter     // relay history 按 member 限流
	timing            multi.TimingConfig // 对局时间常量（Phase 6 统一接 config）
	chatRetention     time.Duration
	chatRate          multi.ChatRateConfig
	chatCursor        *multi.ChatCursorCodec
	announcements     *multi.SystemAnnouncementWriter
	hub               *hub.Hub // 实时通道（事件先入库后广播；nil 时 Publish 空转）
	projectionSecret  []byte   // 对手匿名矩阵 HMAC 密钥（快照/重放/实时共用）
	rollout           RolloutConfig
	characterSearch   CharacterSearchConfig
	answerMatchPolicy game.AnswerMatchPolicy
	catalogRuntimes   *game.CatalogRuntimeProvider
	guessEvaluator    *game.GuessEvaluator
}

// Option 定制 Server（测试注入用）。
type Option func(*Server)

// CharacterSearchConfig controls optional filters assembled around the shared
// character search implementation.
type CharacterSearchConfig struct {
	QuestionScopeFilterEnabled bool
}

func characterSearchConfigFromEnv() CharacterSearchConfig {
	return CharacterSearchConfig{
		QuestionScopeFilterEnabled: config.CharacterSearchQuestionScopeFilterEnabled(),
	}
}

// WithCharacterSearchConfig overrides character search filters for tests and
// staged deployments.
func WithCharacterSearchConfig(searchConfig CharacterSearchConfig) Option {
	return func(s *Server) {
		s.characterSearch = searchConfig
	}
}

func WithAnswerMatchPolicy(policy game.AnswerMatchPolicy) Option {
	return func(s *Server) {
		s.answerMatchPolicy = policy
	}
}

// RolloutConfig 定义多人玩法灰度开关。固定积分 relay 默认开启；淘汰赛和
// 其他可选入口仍可独立关闭。服务端开关是最终授权边界。
type RolloutConfig struct {
	NPlayerRaceEnabled         bool
	NPlayerRelayEnabled        bool
	RelayEliminationEnabled    bool
	ChatSendEnabled            bool
	SystemAnnouncementsEnabled bool
}

func rolloutConfigFromEnv() RolloutConfig {
	return RolloutConfig{
		NPlayerRaceEnabled:         config.MultiNPlayerRaceEnabled(),
		NPlayerRelayEnabled:        config.MultiNPlayerRelayEnabled(),
		RelayEliminationEnabled:    config.MultiRelayEliminationEnabled(),
		ChatSendEnabled:            config.MultiChatSendEnabled(),
		SystemAnnouncementsEnabled: config.MultiSystemAnnouncementsEnabled(),
	}
}

// WithRolloutConfig 覆盖 MPX-010 灰度开关（集成测试和灰度环境注入用）。
func WithRolloutConfig(rollout RolloutConfig) Option {
	return func(s *Server) {
		s.rollout = rollout
	}
}

// WithJoinRateLimit 覆盖加入/预检限流参数（默认每分钟 10 次，进程内计数）。
func WithJoinRateLimit(limit int, window time.Duration) Option {
	return func(s *Server) {
		s.joinLimiter = newIPRateLimiter(limit, window)
	}
}

// WithRelayHistoryRateLimit overrides the authenticated history limiter.
func WithRelayHistoryRateLimit(limit int, window time.Duration) Option {
	return func(s *Server) {
		s.historyLimiter = newIPRateLimiter(limit, window)
	}
}

// WithMultiTiming 覆盖对局时间常量（集成测试注入短值）。
func WithMultiTiming(timing multi.TimingConfig) Option {
	return func(s *Server) {
		s.timing = timing
	}
}

// WithChatConfig 覆盖聊天保留、限流与 cursor 签名配置（测试注入用）。
func WithChatConfig(retention time.Duration, rate multi.ChatRateConfig, secret []byte) Option {
	return func(s *Server) {
		s.chatRetention = retention
		s.chatRate = rate
		s.chatCursor = multi.NewChatCursorCodec(secret)
	}
}

// WithHub 注入实时通道（server.NewWithOptions 默认创建；单实例共享给 sweeper 时显式传入）。
func WithHub(h *hub.Hub) Option {
	return func(s *Server) {
		s.hub = h
		s.projectionSecret = h.ProjectionSecret()
	}
}

// WithMultiplayerKernel injects one registry, clock, and random source for
// deterministic assembly and rule tests. Nil ports keep production defaults.
func WithMultiplayerKernel(registry *core.Registry, clock core.Clock, random core.RandomSource) Option {
	return func(s *Server) {
		if registry != nil {
			s.modeRegistry = registry
		}
		if clock != nil {
			s.now = clock.Now
		}
		if random != nil {
			s.rng = random
		}
	}
}

// publish 事件事务提交后广播（先入库后广播，07 §7.2；hub 未注入时空转）。
func (s *Server) publish(roomID string) {
	if s.hub != nil {
		s.hub.Publish(roomID)
	}
}

func (s *Server) publishChat(message repo.MultiChatMessage) {
	if s.hub != nil {
		s.hub.PublishChat(message.RoomID)
	}
}

func (s *Server) publishChatRoom(roomID string) {
	if s.hub != nil {
		s.hub.PublishChat(roomID)
	}
}

func NewServer(pool *pgxpool.Pool, opts ...Option) *Server {
	clock := core.SystemClock{}
	answerMatchPolicy, err := game.ParseAnswerMatchPolicy(config.AnswerMatchPolicy())
	if err != nil {
		panic("handler: " + err.Error())
	}
	s := &Server{
		pool:              pool,
		q:                 repo.New(pool),
		now:               clock.Now,
		rng:               core.NewRandomSource(),
		modeRegistry:      assembly.MustProduction(),
		lobbyTTL:          config.MultiLobbyTTL(),
		eventRetention:    config.MultiEventRetention(),
		joinLimiter:       newIPRateLimiter(config.MultiJoinRateLimit(), time.Minute),
		historyLimiter:    newIPRateLimiter(config.MultiRelayHistoryRateLimit(), time.Minute),
		timing:            multi.DefaultTimingConfig(),
		chatRetention:     config.MultiChatRetention(),
		chatRate:          config.MultiChatRate(),
		chatCursor:        multi.NewChatCursorCodec(config.MultiChatCursorSecret()),
		projectionSecret:  config.MultiProjectionSecret(),
		rollout:           rolloutConfigFromEnv(),
		characterSearch:   characterSearchConfigFromEnv(),
		answerMatchPolicy: answerMatchPolicy,
	}
	for _, opt := range opts {
		opt(s)
	}
	s.announcements = multi.NewSystemAnnouncementWriter(s.rollout.SystemAnnouncementsEnabled)
	s.catalogRuntimes = game.NewCatalogRuntimeProvider(func(ctx context.Context, version string) ([]game.Character, error) {
		return multi.CharactersForVersion(ctx, s.q, version)
	})
	s.guessEvaluator = game.NewGuessEvaluator(s.catalogRuntimes)
	if state, err := s.q.GetCatalogState(context.Background()); err == nil {
		if _, err := s.catalogRuntimes.Get(context.Background(), state.CurrentVersion, s.answerMatchPolicy); err != nil {
			panic("handler: prewarm catalog runtime: " + err.Error())
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		panic("handler: load catalog state: " + err.Error())
	}
	s.configureRelayEngine()
	return s
}

func (s *Server) configureRelayEngine() {
	if _, err := s.modeRegistry.CommandHandler(core.ModeRelay); err != nil {
		return
	}
	clock := core.ClockFunc(s.now)
	coordinator, encounters, err := relayadapter.NewRuntime(s.pool, clock, s.rng, s.timing, s.announcements)
	if err != nil {
		panic("handler: configure relay encounter engine: " + err.Error())
	}
	encounters.SetGuessEvaluator(s.guessEvaluator)
	s.relayCoordinator = coordinator
	s.relayEncounters = encounters
}

// HealthCheck 健康检查。
func (s *Server) HealthCheck(ctx context.Context, _ openapi.HealthCheckRequestObject) (openapi.HealthCheckResponseObject, error) {
	return openapi.HealthCheck200JSONResponse{Ok: true, Service: "touhouflandre-api"}, nil
}

// SiteVisitsCreate 记录一次完整页面访问并返回递增后的全站访问数。
func (s *Server) SiteVisitsCreate(ctx context.Context, _ openapi.SiteVisitsCreateRequestObject) (openapi.SiteVisitsCreateResponseObject, error) {
	count, err := s.q.IncrementSiteVisitCount(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	return openapi.SiteVisitsCreate200JSONResponse(openapi.SiteVisitResponse{Count: count}), nil
}

// CharactersSearch searches the current catalog or a version-bound snapshot.
func (s *Server) CharactersSearch(ctx context.Context, request openapi.CharactersSearchRequestObject) (openapi.CharactersSearchResponseObject, error) {
	query := ""
	if request.Params.Q != nil {
		query = *request.Params.Q
	}
	workIDs := []string{}
	filterByWork := request.Params.WorkIds != nil
	if request.Params.WorkIds != nil {
		for _, workID := range strings.Split(*request.Params.WorkIds, ",") {
			workID = strings.TrimSpace(workID)
			if workID != "" {
				workIDs = append(workIDs, workID)
			}
		}
	}
	limit := 50
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}
	offset := 0
	if request.Params.Offset != nil {
		offset = *request.Params.Offset
	}
	direction := "asc"
	if request.Params.Direction != nil {
		direction = string(*request.Params.Direction)
	}
	if request.Params.SessionId != nil && request.Params.CatalogVersion != nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "sessionId 与 catalogVersion 不能同时提供。"}
	}
	hasRoomID := request.Params.RoomId != nil
	hasMatchIndex := request.Params.MatchIndex != nil
	if hasRoomID != hasMatchIndex {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "roomId 与 matchIndex 必须同时提供。"}
	}
	if hasRoomID && (request.Params.SessionId != nil || request.Params.CatalogVersion != nil) {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "多人场次上下文不能与 sessionId 或 catalogVersion 同时提供。"}
	}

	var characters []game.Character
	var questionScope *game.QuestionScopeConfig
	if request.Params.SessionId != nil {
		session, err := s.q.GetSession(ctx, *request.Params.SessionId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &ApiError{Status: http.StatusNotFound, Code: codeSessionNotFound, Message: "没有找到这一局游戏。"}
			}
			return nil, internalError(err)
		}
		characters, err = s.charactersForVersion(ctx, session.CatalogVersion)
		if err != nil {
			return nil, err
		}
		if s.characterSearch.QuestionScopeFilterEnabled {
			scope, err := questionScopeFromJSON(session.QuestionScope, session.CatalogVersion, nil, characters)
			if err != nil {
				return nil, internalError(err)
			}
			questionScope = &scope
		}
	} else if hasRoomID {
		match, err := s.q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{
			RoomID:     *request.Params.RoomId,
			MatchIndex: int32(*request.Params.MatchIndex),
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &ApiError{Status: http.StatusNotFound, Code: codeRoomNotFound, Message: "没有找到这一场游戏。"}
			}
			return nil, internalError(err)
		}
		characters, err = s.charactersForVersion(ctx, match.CatalogVersion)
		if err != nil {
			return nil, err
		}
		if s.characterSearch.QuestionScopeFilterEnabled {
			scope, err := questionScopeFromJSON(match.QuestionScope, match.CatalogVersion, nil, characters)
			if err != nil {
				return nil, internalError(err)
			}
			questionScope = &scope
		}
	} else if request.Params.CatalogVersion != nil {
		var err error
		characters, err = s.charactersForRequestedVersion(ctx, *request.Params.CatalogVersion)
		if err != nil {
			return nil, err
		}
	} else {
		_, currentCharacters, err := s.getCurrentCatalog(ctx)
		if err != nil {
			return nil, err
		}
		characters = currentCharacters
	}

	sortBy := "name"
	if request.Params.Sort != nil && *request.Params.Sort == openapi.Appearance {
		sortBy = "appearance"
	}
	filters := []game.CharacterSearchFilter{game.EnabledAsGuessSearchFilter()}
	if filterByWork {
		filters = append(filters, game.WorkIDsSearchFilter(workIDs))
	}
	if questionScope != nil {
		filters = append(filters, game.CharacterIDsSearchFilter(questionScope.SelectedCharacterIDs))
	}
	page := game.SearchCharacters(characters, game.CharacterSearchOptions{
		Query: query, Filters: filters,
		SortBy: sortBy, Descending: direction == "desc", Offset: offset, Limit: limit,
	})
	results := make([]openapi.CharacterSearchResult, 0, len(page.Characters))
	for _, character := range page.Characters {
		results = append(results, toSearchResult(character, game.CharacterSearchText(character), game.CharacterNameSortKey(character)))
	}
	return openapi.CharactersSearch200JSONResponse{Results: results, Total: page.Total}, nil
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
	works, err := s.q.ListWorks(ctx)
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
		Works: make([]openapi.Work, 0, len(works)),
	}
	for _, work := range works {
		summary.Works = append(summary.Works, toOpenAPIWork(work))
	}
	return openapi.CatalogGet200JSONResponse(summary), nil
}

// CatalogCharacters 在兼容期内返回完整可猜角色表和当前版本。
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

// CatalogFull 当前全量题库快照，供题库设置弹窗和版本修正使用。
func (s *Server) CatalogFull(ctx context.Context, _ openapi.CatalogFullRequestObject) (openapi.CatalogFullResponseObject, error) {
	version, characters, works, err := s.currentCatalogWithWorks(ctx)
	if err != nil {
		return nil, err
	}
	openapiCharacters := make([]openapi.Character, 0, len(characters))
	for _, character := range characters {
		openapiCharacters = append(openapiCharacters, toOpenAPICharacter(character))
	}
	openapiWorks := make([]openapi.Work, 0, len(works))
	for _, work := range works {
		openapiWorks = append(openapiWorks, toOpenAPIWork(work))
	}
	defaultScope := game.DefaultQuestionScope(version, questionScopeWorks(works), characters, game.QuestionDifficultyNormal)
	return openapi.CatalogFull200JSONResponse(openapi.CatalogFull{
		Version:              version,
		Characters:           openapiCharacters,
		Works:                openapiWorks,
		FieldDefinitions:     toOpenAPIGuessFieldDefinitions(game.CharacterFields.Definitions()),
		DefaultQuestionScope: toOpenAPIQuestionScope(defaultScope),
	}), nil
}

// PuzzlesCreate 创建题局（每日题或随机）。
func (s *Server) PuzzlesCreate(ctx context.Context, request openapi.PuzzlesCreateRequestObject) (openapi.PuzzlesCreateResponseObject, error) {
	definition := game.SinglePlayerModeDefinitions[string(request.Mode)]
	if definition.ID == "" {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "不支持的模式。"}
	}
	var requestedScope *game.QuestionScopeConfig
	dailyDifficulty := game.QuestionDifficultyNormal
	if request.Body != nil {
		requestedScope = questionScopeFromOpenAPI(request.Body.QuestionScope)
		if request.Body.Difficulty != nil {
			dailyDifficulty = game.QuestionDifficulty(*request.Body.Difficulty)
		}
	}
	selection, err := s.selectAnswer(ctx, string(request.Mode), definition, requestedScope, dailyDifficulty)
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
		if request.Body.ExpectedGuessCount != nil &&
			len(guesses) != *request.Body.ExpectedGuessCount {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeConcurrentUpdate, Message: "本回合已经发生变化，请重新提交。"}
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
		scope, err := questionScopeFromJSON(session.QuestionScope, session.CatalogVersion, nil, characters)
		if err != nil {
			return nil, internalError(err)
		}
		policy, err := game.ParseAnswerMatchPolicy(session.AnswerMatchPolicy)
		if err != nil {
			return nil, internalError(err)
		}
		result, err := s.guessEvaluator.Evaluate(ctx, session.CatalogVersion, policy, session.AnswerID, guessID, game.FieldsForQuestionScope(scope))
		if err != nil {
			switch {
			case errors.Is(err, game.ErrGuessCharacterMissing), errors.Is(err, game.ErrGuessCharacterDisabled):
				return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidGuess, Message: "请选择本局题库中的角色。"}
			case errors.Is(err, game.ErrAnswerCharacterMissing):
				return nil, &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: "本局题库快照中缺少答案角色。"}
			default:
				return nil, internalError(err)
			}
		}
		nextGuesses := append(guesses, result)
		nextStatus := game.SessionPlaying
		if result.IsCorrect {
			nextStatus = game.SessionWon
		} else if len(nextGuesses) >= int(session.MaxGuesses) {
			nextStatus = game.SessionLost
		}

		public, err := s.updateSessionState(ctx, session, nextGuesses, nextStatus, characters)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue // 版本冲突，重试
			}
			return nil, internalError(err)
		}
		return openapi.SessionsSubmitGuess200JSONResponse{Session: public}, nil
	}

	return nil, &ApiError{Status: http.StatusConflict, Code: codeConcurrentUpdate, Message: "会话刚刚发生变化，请重新提交。"}
}

// SessionsTimeout 记录单人模式的一次超时空过。
func (s *Server) SessionsTimeout(ctx context.Context, request openapi.SessionsTimeoutRequestObject) (openapi.SessionsTimeoutResponseObject, error) {
	for attempt := 0; attempt < 2; attempt++ {
		session, err := s.q.GetSession(ctx, request.SessionId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &ApiError{Status: http.StatusNotFound, Code: codeSessionNotFound, Message: "没有找到这一局游戏。"}
			}
			return nil, internalError(err)
		}
		var guesses []game.GuessResult
		if err := jsonUnmarshal(session.Guesses, &guesses); err != nil {
			return nil, internalError(err)
		}
		if request.Body != nil &&
			request.Body.ExpectedGuessCount != nil &&
			len(guesses) != *request.Body.ExpectedGuessCount {
			characters, err := s.charactersForVersion(ctx, session.CatalogVersion)
			if err != nil {
				return nil, err
			}
			public, err := toPublicSession(session, characters)
			if err != nil {
				return nil, internalError(err)
			}
			return openapi.SessionsTimeout200JSONResponse{Session: public}, nil
		}
		if session.Status != string(game.SessionPlaying) {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeSessionClosed, Message: "这一局已经结束。"}
		}
		if len(guesses) >= int(session.MaxGuesses) {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeGuessLimitReached, Message: "本局猜测次数已用尽。"}
		}

		characters, err := s.charactersForVersion(ctx, session.CatalogVersion)
		if err != nil {
			return nil, err
		}
		scope, err := questionScopeFromJSON(session.QuestionScope, session.CatalogVersion, nil, characters)
		if err != nil {
			return nil, internalError(err)
		}
		if !scope.Rules.TurnLimit.Enabled {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeInvalidRequest, Message: "本局未开启单手限时。"}
		}

		sequence := len(guesses) + 1
		nextGuesses := append(guesses, game.GuessResult{
			Kind:      "timeout",
			GuessID:   fmt.Sprintf("__timeout__:%d", sequence),
			GuessName: "超时空过",
			IsCorrect: false,
			Feedback:  []game.FieldFeedback{},
		})
		nextStatus := game.SessionPlaying
		if len(nextGuesses) >= int(session.MaxGuesses) {
			nextStatus = game.SessionLost
		}

		public, err := s.updateSessionState(ctx, session, nextGuesses, nextStatus, characters)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, internalError(err)
		}
		return openapi.SessionsTimeout200JSONResponse{Session: public}, nil
	}

	return nil, &ApiError{Status: http.StatusConflict, Code: codeConcurrentUpdate, Message: "会话刚刚发生变化，请重新提交。"}
}

// SessionsForfeit 放弃本局并直接结算为失败。
func (s *Server) SessionsForfeit(ctx context.Context, request openapi.SessionsForfeitRequestObject) (openapi.SessionsForfeitResponseObject, error) {
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
	characters, err := s.charactersForVersion(ctx, session.CatalogVersion)
	if err != nil {
		return nil, err
	}
	var guesses []game.GuessResult
	if err := jsonUnmarshal(session.Guesses, &guesses); err != nil {
		return nil, internalError(err)
	}
	public, err := s.updateSessionState(ctx, session, guesses, game.SessionLost, characters)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeConcurrentUpdate, Message: "会话刚刚发生变化，请重新执行。"}
		}
		return nil, internalError(err)
	}
	return openapi.SessionsForfeit200JSONResponse{Session: public}, nil
}

func (s *Server) updateSessionState(
	ctx context.Context,
	session repo.GameSession,
	guesses []game.GuessResult,
	nextStatus game.SessionStatus,
	characters []game.Character,
) (openapi.PublicGameSession, error) {
	guessesJSON, err := jsonMarshal(guesses)
	if err != nil {
		return openapi.PublicGameSession{}, internalError(err)
	}
	var endedAtValue pgtype.Timestamptz
	if nextStatus != game.SessionPlaying {
		now := s.now().UTC()
		endedAtValue = pgtype.Timestamptz{Time: now, Valid: true}
	}

	updated, err := s.q.UpdateSessionGuess(ctx, repo.UpdateSessionGuessParams{
		ID:      session.ID,
		Version: session.Version,
		Guesses: guessesJSON,
		Status:  string(nextStatus),
		EndedAt: endedAtValue,
	})
	if err != nil {
		return openapi.PublicGameSession{}, err
	}
	return toPublicSession(updated, characters)
}
