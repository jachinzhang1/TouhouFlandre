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
	"github.com/jackc/pgx/v5/pgconn"
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
	answerID, err := multi.DrawAnswer(multi.AnswerPool(characters), map[string]bool{}, s.rng)
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
	})
	if err != nil {
		return mapRoomWriteError(err)
	}
	startsAt := now.Add(s.timing.RoundCountdown)
	round, err := q.CreateRound(ctx, repo.CreateRoundParams{
		ID:         multi.NewID(),
		MatchID:    match.ID,
		MaxRounds:  int32(maxRounds),
		RoundIndex: 1,
		AnswerID:   answerID,
		StartsAt:   timestamptz(startsAt),
		Deadline:   timestamptz(startsAt.Add(s.timing.RoundSeconds)),
	})
	if err != nil {
		return mapRoomWriteError(err)
	}
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventMatchStarted, multi.MatchStartedPayload{
		Format:         format,
		TargetWins:     targetWins,
		CatalogVersion: state.CurrentVersion,
		MatchIndex:     int(match.MatchIndex),
	}); err != nil {
		return internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoundStarted, multi.RoundStartedPayload{
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(round.RoundIndex),
		StartsAt:   startsAt,
		Deadline:   startsAt.Add(s.timing.RoundSeconds),
		MaxGuesses: multi.GameMaxGuesses,
	}); err != nil {
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
	// 3. 角色校验与反馈计算（真实列序）
	guessChar, statuses, isCorrect, apiErr := s.computeFeedback(ctx, q, match.CatalogVersion, round.AnswerID, request.Body.GuessId)
	if apiErr != nil {
		return nil, apiErr
	}
	// 4. 局态分流（不可猜时不写入，仅返回结果）
	switch round.Status {
	case string(multi.RoundStatusEnded):
		if isCorrect {
			return nil, roundEndedWithResult(round)
		}
		return nil, roundNotActiveError("本局已结束。")
	case string(multi.RoundStatusCountdown):
		return nil, roundNotActiveError("本局尚未开始。")
	case string(multi.RoundStatusPlaying):
		if !s.now().Before(round.Deadline.Time) {
			// 4b 整局超时：猜测事务内同步结算平局（谁先发现超时谁结算，状态一致）。
			// 结算必须先提交（返回错误会触发 deferred rollback 丢失结算）。
			if err := s.settleTimeoutInTxn(ctx, q, room.ID, round, match); err != nil {
				return nil, internalError(err)
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, internalError(err)
			}
			s.publish(request.RoomId)
			return nil, roundNotActiveError("本局已超时（按平局结算）。")
		}
		if s.now().Before(round.StartsAt.Time) {
			return nil, roundNotActiveError("本局尚未到开猜时间。")
		}
	default:
		return nil, roundNotActiveError("本局不可猜测。")
	}

	// 5. 幂等：同 (round, member, idempotencyKey) 重试返回首次结果，不重复处理
	existing, err := q.GetGuessByIdempotencyKey(ctx, repo.GetGuessByIdempotencyKeyParams{
		RoundID: round.ID, MemberID: member.ID, IdempotencyKey: request.Body.IdempotencyKey,
	})
	if err == nil {
		return s.guessAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, existing)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, internalError(err)
	}

	// 6. 每局每人上限（08 §4.3：用尽后不能再提交，但对手仍可继续）
	count, err := q.CountGuessesForRoundMember(ctx, repo.CountGuessesForRoundMemberParams{
		RoundID: round.ID, MemberID: member.ID,
	})
	if err != nil {
		return nil, internalError(err)
	}
	if int(count) >= multi.GameMaxGuesses {
		return nil, &ApiError{Status: http.StatusConflict, Code: codeGuessLimitReached, Message: "本局猜测次数已用尽。"}
	}
	sequence := int(count) + 1

	// 7. 写入猜测（幂等键 ON CONFLICT DO NOTHING；guess_id 唯一冲突 → DUPLICATE_GUESS）
	statusesJSON, err := json.Marshal(statuses)
	if err != nil {
		return nil, internalError(err)
	}
	_, err = q.InsertGuess(ctx, repo.InsertGuessParams{
		ID:             multi.NewID(),
		RoundID:        round.ID,
		MemberID:       member.ID,
		Sequence:       int32(sequence),
		GuessID:        guessChar.ID,
		Statuses:       statusesJSON,
		IsCorrect:      isCorrect,
		IdempotencyKey: request.Body.IdempotencyKey,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "multi_guess_round_id_member_id_guess_id_key" {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "本局已猜过该角色。"}
		}
		return nil, mapRoomWriteError(err)
	}

	// 8. 猜测事件（规范形态：真实列序 + 猜测者 slot + roundID；投影阶段剥离/置换）
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoundOpponentGuess, multi.RoundGuessPayload{
		RoundID:    round.ID,
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(round.RoundIndex),
		MemberSlot: int(member.Slot),
		RowIndex:   sequence,
		Statuses:   statuses,
	}); err != nil {
		return nil, internalError(err)
	}

	// 9. 单局结束判定（猜中 > 双方用尽）
	members, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	opponentID := ""
	for _, m := range members {
		if m.ID != member.ID {
			opponentID = m.ID
			break
		}
	}
	opponentCount := int64(0)
	if opponentID != "" {
		opponentCount, err = q.CountGuessesForRoundMember(ctx, repo.CountGuessesForRoundMemberParams{
			RoundID: round.ID, MemberID: opponentID,
		})
		if err != nil {
			return nil, internalError(err)
		}
	}
	winnerSlot := 0
	if isCorrect {
		winnerSlot = int(member.Slot)
	}
	roundEnd := multi.SettleRoundEnd(winnerSlot, [2]int{sequence, int(opponentCount)}, multi.GameMaxGuesses, false)
	// 响应在提交前组装（自视角完整反馈，按快照水合；tx 尚未关闭）
	response, err := s.guessAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, repo.MultiGuess{
		GuessID:   guessChar.ID,
		Statuses:  statusesJSON,
		IsCorrect: isCorrect,
	})
	if err != nil {
		return nil, err
	}
	if roundEnd.Ended {
		var winner pgtype.Int4
		if roundEnd.WinnerSlot != 0 {
			winner = pgtype.Int4{Int32: int32(roundEnd.WinnerSlot), Valid: true}
		}
		if _, err := q.EndRound(ctx, repo.EndRoundParams{ID: round.ID, WinnerSlot: winner, EndedAt: timestamptz(s.now())}); err != nil {
			return nil, internalError(err)
		}
		// 10. 比分与场次推进
		advance := multi.AdvanceMatch([2]int{int(match.ScoreSlot1), int(match.ScoreSlot2)},
			int(match.TargetWins), int(match.RoundCount), multi.MaxRounds(multi.RoomFormat(room.Format), s.timing.MaxRoundsFactor), roundEnd.WinnerSlot)
		if _, err := q.UpdateMatchScore(ctx, repo.UpdateMatchScoreParams{
			ID:        match.ID,
			ScoreSlot1: int32(advance.Score[0]),
			ScoreSlot2: int32(advance.Score[1]),
		}); err != nil {
			return nil, internalError(err)
		}
		var roundWinnerSlot *int
		if roundEnd.WinnerSlot != 0 {
			slot := roundEnd.WinnerSlot
			roundWinnerSlot = &slot
		}
		if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoundEnded, multi.RoundEndedEventPayload{
			RoundID:    round.ID,
			MatchIndex: int(match.MatchIndex),
			RoundIndex: int(round.RoundIndex),
			WinnerSlot: roundWinnerSlot,
			AnswerID:   round.AnswerID,
			Scores:     multi.ScoresView{Slot1: advance.Score[0], Slot2: advance.Score[1]},
		}); err != nil {
			return nil, internalError(err)
		}
		if advance.MatchEnded {
			if _, err := q.EndMatch(ctx, repo.EndMatchParams{ID: match.ID, EndedAt: timestamptz(s.now())}); err != nil {
				return nil, internalError(err)
			}
			if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
				ID:        room.ID,
				Status:    string(multi.RoomStatusFinished),
				ExpiresAt: timestamptz(s.now().Add(s.timing.FinishedRetention)),
			}); err != nil {
				return nil, internalError(err)
			}
			var matchWinnerSlot *int
			if advance.WinnerSlot != 0 {
				slot := advance.WinnerSlot
				matchWinnerSlot = &slot
			}
			if err := multi.AppendEvent(ctx, q, room.ID, multi.EventMatchEnded, multi.MatchEndedEventPayload{
				MatchIndex: int(match.MatchIndex),
				WinnerSlot: matchWinnerSlot,
				Scores:     multi.ScoresView{Slot1: advance.Score[0], Slot2: advance.Score[1]},
				Reason:     advance.Reason,
			}); err != nil {
				return nil, internalError(err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return response, nil
}

// computeFeedback 校验角色并计算反馈（真实列序状态数组）。
func (s *Server) computeFeedback(ctx context.Context, q *repo.Queries, catalogVersion, answerID, guessID string) (game.Character, []string, bool, *ApiError) {
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
	result := game.CompareCharacter(guess, answer, game.CharacterGuessFields)
	statuses := make([]string, len(result.Feedback))
	for i, fb := range result.Feedback {
		statuses[i] = string(fb.Status)
	}
	return guess, statuses, guess.ID == answer.ID, nil
}

// settleTimeoutInTxn 猜测事务内的超时结算（§9.2 步骤 4b）：本局判平，本次猜测不写入。
func (s *Server) settleTimeoutInTxn(ctx context.Context, q *repo.Queries, roomID string, round repo.MultiRound, match repo.MultiMatch) error {
	if _, err := q.EndRound(ctx, repo.EndRoundParams{
		ID:        round.ID,
		WinnerSlot: pgtype.Int4{},
		EndedAt:   timestamptz(s.now()),
	}); err != nil {
		return err
	}
	return multi.AppendEvent(ctx, q, roomID, multi.EventRoundEnded, multi.RoundEndedEventPayload{
		RoundID:   round.ID,
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(round.RoundIndex),
		WinnerSlot: nil,
		AnswerID:   round.AnswerID,
		Scores:     multi.ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)},
	})
}

// guessAcceptedResponse 组装 200 响应（自视角完整反馈，按快照水合）。
// q 须绑定在未提交的事务上（幂等重放路径与正常路径均在提交前调用）。
func (s *Server) guessAcceptedResponse(ctx context.Context, roundIndex int, q *repo.Queries, catalogVersion string, guess repo.MultiGuess) (openapi.RoomsSubmitGuessResponseObject, error) {
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
	hydrated := multi.HydrateGuessResult(guessChar, statuses, guess.IsCorrect)
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
			MemberSlot: int(member.Slot),
		}); err != nil {
			return nil, internalError(err)
		}
	}
	after, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	// 双方确认且都 connected → 开新场（同一事务，锁房间行）
	bothReady := len(after) == 2 && after[0].RematchReady && after[1].RematchReady
	bothConnected := len(after) == 2 && after[0].Status == string(multi.MemberStatusConnected) && after[1].Status == string(multi.MemberStatusConnected)
	if bothReady && bothConnected {
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
