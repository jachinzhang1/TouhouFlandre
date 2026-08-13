// 对局引擎 handler（Phase 3）：开局（ready/rematch）、猜测事务、再来一局。
// 锁序纪律（08 §9.2）：猜测/弃赛/推进统一 局→场→房间；大厅命令只锁房间行。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// startMatchTx 在调用方事务（已锁房间行）内开局：绑当前题库版本 → 抽题 → 建 round 1（countdown）
// → 事件 match.started + round.started → room lobby→playing（08 §6.1）。
func (s *Server) startMatchTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, format multi.RoomFormat) error {
	state, err := q.GetCatalogState(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &ApiError{Status: http.StatusServiceUnavailable, Code: codeCatalogNotReady, Message: "题库尚未初始化，请先运行 seed。"}
		}
		return internalError(err)
	}
	characters, err := multi.CharactersForVersion(ctx, q, state.CurrentVersion)
	if err != nil {
		return internalError(err)
	}
	works, err := q.ListWorks(ctx)
	if err != nil {
		return internalError(err)
	}
	storedScope, err := storedQuestionScopeFromJSON(room.QuestionScope)
	if err != nil {
		return internalError(err)
	}
	correction := normalizeQuestionScopeForCatalog(&storedScope, state.CurrentVersion, characters, works)
	scope := correction.Config
	scopeJSON, err := questionScopeJSON(scope)
	if err != nil {
		return internalError(err)
	}
	if correction.Changed {
		updatedRoom, err := q.UpdateRoomQuestionScope(ctx, repo.UpdateRoomQuestionScopeParams{
			ID:            room.ID,
			QuestionScope: scopeJSON,
		})
		if err != nil {
			return internalError(err)
		}
		room = updatedRoom
	}
	answerID, err := multi.DrawAnswer(game.QuestionScopeAnswerPool(scope), map[string]bool{}, s.rng)
	if err != nil {
		return &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: "题库中没有可作为答案的角色。"}
	}

	now := s.now()
	targetWins := multi.TargetWins(format)
	maxRounds := multi.MaxRounds(format, s.timing.MaxRoundsFactor)
	match, err := q.CreateMatch(ctx, repo.CreateMatchParams{
		ID:             multi.NewID(),
		RoomID:         room.ID,
		CatalogVersion: state.CurrentVersion,
		TargetWins:     int32(targetWins),
		StartedAt:      timestamptz(now),
		QuestionScope:  scopeJSON,
	})
	if err != nil {
		return mapRoomWriteError(err)
	}
	startsAt := now.Add(s.timing.RoundCountdown)
	turnSlot, turnDeadline := multi.InitialTurnParams(room, 1, startsAt)
	round, err := q.CreateRound(ctx, repo.CreateRoundParams{
		ID:           multi.NewID(),
		MatchID:      match.ID,
		MaxRounds:    int32(maxRounds),
		RoundIndex:   1,
		AnswerID:     answerID,
		StartsAt:     timestamptz(startsAt),
		Deadline:     timestamptz(startsAt.Add(s.timing.RoundSeconds)),
		TurnSlot:     turnSlot,
		TurnDeadline: turnDeadline,
	})
	if err != nil {
		return mapRoomWriteError(err)
	}
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventMatchStarted, multi.MatchStartedPayload{
		Format:         format,
		Mode:           multi.MultiplayerMode(room.Mode),
		TurnSeconds:    int(room.TurnSeconds),
		TargetWins:     targetWins,
		CatalogVersion: state.CurrentVersion,
		MatchIndex:     int(match.MatchIndex),
		QuestionScope:  scope,
	}); err != nil {
		return internalError(err)
	}
	maxGuesses := game.EffectiveQuestionScopeMaxGuesses(scope.Rules)
	members, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return internalError(err)
	}
	roundStarted := multi.RoundStartedPayload{
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(round.RoundIndex),
		StartsAt:   startsAt,
		Deadline:   startsAt.Add(s.timing.RoundSeconds),
		MaxGuesses: maxGuesses,
	}
	multi.AddRelayRoundStartedFields(&roundStarted, room, members, int(round.RoundIndex), startsAt)
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoundStarted, roundStarted); err != nil {
		return internalError(err)
	}
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID:        room.ID,
		Status:    string(multi.RoomStatusPlaying),
		ExpiresAt: room.ExpiresAt,
	}); err != nil {
		return internalError(err)
	}
	return nil
}

// RoomsSubmitGuess 提交猜测（08 §9.2 猜测事务全流程）。
// 响应为自视角完整反馈；局中不返回答案与对手信息。
func (s *Server) RoomsSubmitGuess(ctx context.Context, request openapi.RoomsSubmitGuessRequestObject) (openapi.RoomsSubmitGuessResponseObject, error) {
	started := time.Now()
	defer func() { multi.DefaultMetrics.RecordGuessLatency(time.Since(started)) }()
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	if apiErr := requirePlayer(member); apiErr != nil {
		return nil, apiErr
	}
	if request.Body == nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "缺少请求体。"}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	// 0. 房间存在性
	room, err := q.GetRoom(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if room.Status == string(multi.RoomStatusLobby) || room.Status == string(multi.RoomStatusClosed) {
		return nil, roomClosed()
	}

	// 1. 锁局行（局→场→房间）：房间当前场的最新局
	round, err := q.GetCurrentRoundForUpdateByRoom(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 无进行中的场/局：finished → 局已结束；playing 无局为内部不一致
			if room.Status == string(multi.RoomStatusFinished) {
				return nil, roundEndedError("对局已结束。")
			}
			return nil, roundNotActiveError("当前没有可猜测的局。")
		}
		return nil, internalError(err)
	}
	if int(round.RoundIndex) != request.RoundIndex {
		return nil, roundNotActiveError("目标局不是当前局。")
	}
	// 2. 锁场行
	match, err := q.GetMatchForUpdate(ctx, round.MatchID)
	if err != nil {
		return nil, internalError(err)
	}
	module, ok := guessModeModules[multi.MultiplayerMode(room.Mode)]
	if !ok {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "未知多人玩法。"}
	}
	result, err := module.SubmitGuess(ctx, s, q, submitGuessInput{
		request: request,
		member:  *member,
		room:    room,
		round:   round,
		match:   match,
	})
	if result.commit {
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return nil, internalError(commitErr)
		}
		if result.publish {
			s.publish(request.RoomId)
		}
	}
	if err != nil {
		return nil, err
	}
	return result.response, nil
}

// computeFeedback 校验角色并计算反馈（真实列序状态数组）。
func (s *Server) computeFeedback(ctx context.Context, q *repo.Queries, catalogVersion, answerID, guessID string, fields []game.GuessField) (game.Character, []string, bool, *ApiError) {
	characters, err := multi.CharactersForVersion(ctx, q, catalogVersion)
	if err != nil {
		return game.Character{}, nil, false, internalError(err)
	}
	byID := multi.CharactersByID(characters)
	guess, ok := byID[guessID]
	if !ok || !guess.EnabledAsGuess {
		return game.Character{}, nil, false, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidGuess, Message: "该角色不在本局题库中。"}
	}
	answer, ok := byID[answerID]
	if !ok {
		return game.Character{}, nil, false, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidGuess, Message: "本局答案缺失。"}
	}
	result := game.CompareCharacter(guess, answer, fields)
	statuses := make([]string, len(result.Feedback))
	for i, fb := range result.Feedback {
		statuses[i] = string(fb.Status)
	}
	return guess, statuses, guess.ID == answer.ID, nil
}

// settleTimeoutInTxn 猜测事务内的超时结算（§9.2 步骤 4b）：本局判平，本次猜测不写入。
func (s *Server) settleTimeoutInTxn(ctx context.Context, q *repo.Queries, roomID string, round repo.MultiRound, match repo.MultiMatch) error {
	if _, err := q.EndRound(ctx, repo.EndRoundParams{
		ID:         round.ID,
		WinnerSlot: pgtype.Int4{},
		EndedAt:    timestamptz(s.now()),
	}); err != nil {
		return err
	}
	return multi.AppendEvent(ctx, q, roomID, multi.EventRoundEnded, multi.RoundEndedEventPayload{
		RoundID:    round.ID,
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(round.RoundIndex),
		WinnerSlot: nil,
		AnswerID:   round.AnswerID,
		Scores:     multi.ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)},
	})
}

// guessAcceptedResponse 组装 200 响应（自视角完整反馈，按快照水合）。
// q 须绑定在未提交的事务上（幂等重放路径与正常路径均在提交前调用）。
func (s *Server) guessAcceptedResponse(ctx context.Context, roundIndex int, q *repo.Queries, catalogVersion string, guess repo.MultiGuess, fields []game.GuessField) (openapi.RoomsSubmitGuessResponseObject, error) {
	var statuses []string
	if err := json.Unmarshal(guess.Statuses, &statuses); err != nil {
		return nil, internalError(err)
	}
	characters, err := multi.CharactersForVersion(ctx, q, catalogVersion)
	if err != nil {
		return nil, internalError(err)
	}
	guessChar, ok := multi.CharactersByID(characters)[guess.GuessID]
	if !ok {
		return nil, internalError(errors.New("guess character missing from snapshot"))
	}
	hydrated := multi.HydrateGuessResultWithFields(guessChar, statuses, guess.IsCorrect, fields)
	return openapi.RoomsSubmitGuess200JSONResponse{
		RoundIndex: roundIndex,
		Guess:      toOpenAPIGuessResult(hydrated),
	}, nil
}

// RoomsRematch 确认再来一局（08 §6.1/§4.6）：finished 后任意成员确认（幂等）；
// 双方确认且都 connected 时同一事务开新场（match_index+1、重绑版本、比分清零）。
func (s *Server) RoomsRematch(ctx context.Context, request openapi.RoomsRematchRequestObject) (openapi.RoomsRematchResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	if apiErr := requirePlayer(member); apiErr != nil {
		return nil, apiErr
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	room, err := q.GetRoomForUpdate(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if room.Status == string(multi.RoomStatusClosed) {
		return nil, roomClosed()
	}
	if room.Status != string(multi.RoomStatusFinished) {
		return nil, &ApiError{Status: http.StatusConflict, Code: codeRematchNotAvailable, Message: "对局未结束，无法再来一局。"}
	}
	alreadyConfirmed := false
	members, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	requesterConnected := false
	for _, rosterMember := range members {
		if rosterMember.Status == string(multi.MemberStatusLeft) {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeRematchNotAvailable, Message: "原对局阵容已有成员离开，无法再来一局。"}
		}
		if rosterMember.ID == member.ID && rosterMember.Status == string(multi.MemberStatusConnected) {
			requesterConnected = true
		}
	}
	if !requesterConnected {
		return nil, &ApiError{Status: http.StatusConflict, Code: codeRematchNotAvailable, Message: "请先重新连接房间后再确认。"}
	}
	for _, m := range members {
		if m.ID == member.ID && m.RematchReady {
			alreadyConfirmed = true
			break
		}
	}
	if !alreadyConfirmed {
		if _, err := q.SetMemberRematchReady(ctx, repo.SetMemberRematchReadyParams{ID: member.ID, RematchReady: true}); err != nil {
			return nil, internalError(err)
		}
		if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventMatchRematch, multi.MatchRematchPayload{
			MemberID: member.ID,
			Seat:     multi.MemberSeat(*member),
		}); err != nil {
			return nil, internalError(err)
		}
	}
	after, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	// 原冻结 player 集合全员 connected + confirmed → 按原阵容开新场。
	if multi.RematchRosterReady(after, int(room.PlayerLimit)) {
		format := multi.RoomFormat(room.Format)
		if err := s.startMatchTx(ctx, q, room, format); err != nil {
			return nil, err
		}
		for _, m := range after {
			if _, err := q.SetMemberRematchReady(ctx, repo.SetMemberRematchReadyParams{ID: m.ID, RematchReady: false}); err != nil {
				return nil, internalError(err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return openapi.RoomsRematch204Response{}, nil
}

func roundNotActiveError(message string) *ApiError {
	return &ApiError{Status: http.StatusConflict, Code: codeRoundNotActive, Message: message}
}

func roundEndedError(message string) *ApiError {
	return &ApiError{Status: http.StatusConflict, Code: codeRoundEnded, Message: message}
}

// roundEndedWithResult 局结束后正确猜测迟到：ROUND_ENDED 携带局结果（猜测不写入）。
func roundEndedWithResult(round repo.MultiRound) *ApiError {
	result := "平局"
	if round.WinnerSlot.Valid {
		result = "slot " + strconv.Itoa(int(round.WinnerSlot.Int32)) + " 胜"
	}
	return roundEndedError("本局已结束（" + result + "）。")
}

// timestamptz 构造非空 timestamptz 参数（handler 层辅助）。
func timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
