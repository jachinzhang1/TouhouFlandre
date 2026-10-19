package handler

import (
	"errors"
	"net/http"

	"github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// Keep the legacy stored rows (including timeout rows) at the application
// boundary. The core only needs the duplicate IDs and consumed allowance.
func sessionAttemptState(session repo.GameSession, guesses []game.GuessResult) guessing.AttemptState {
	ids := make([]string, len(guesses))
	for i, guess := range guesses {
		ids[i] = guess.GuessID
	}
	return guessing.AttemptState{
		GuessedIDs: ids, Used: len(guesses), Limit: int(session.MaxGuesses),
		Closed: session.Status != string(game.SessionPlaying),
	}
}

func mapSessionAttemptError(err error) *ApiError {
	switch {
	case errors.Is(err, guessing.ErrAttemptsClosed):
		return &ApiError{Status: http.StatusConflict, Code: codeSessionClosed, Message: "这一局已经结束。"}
	case errors.Is(err, guessing.ErrDuplicateGuess):
		return &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "这个角色已经猜过了。"}
	case errors.Is(err, guessing.ErrAttemptLimitReached):
		return &ApiError{Status: http.StatusConflict, Code: codeGuessLimitReached, Message: "本局猜测次数已用尽。"}
	default:
		return internalError(err)
	}
}
