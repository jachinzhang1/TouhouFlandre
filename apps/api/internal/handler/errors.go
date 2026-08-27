package handler

import (
	"net/http"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

// ApiError 携带 HTTP 状态与稳定错误码，输出为契约的 ErrorResponse。
type ApiError struct {
	Status  int
	Code    openapi.ErrorResponseCode
	Message string
	cause   error
}

func (e *ApiError) Error() string { return e.Message }

func (e *ApiError) Unwrap() error { return e.cause }

func (e *ApiError) Response() openapi.ErrorResponse {
	return openapi.ErrorResponse{Code: e.Code, Error: e.Message}
}

const (
	codeInvalidRequest         openapi.ErrorResponseCode = "INVALID_REQUEST"
	codeInvalidGuess           openapi.ErrorResponseCode = "INVALID_GUESS"
	codeSessionNotFound        openapi.ErrorResponseCode = "SESSION_NOT_FOUND"
	codeSessionClosed          openapi.ErrorResponseCode = "SESSION_CLOSED"
	codeDuplicateGuess         openapi.ErrorResponseCode = "DUPLICATE_GUESS"
	codeConcurrentUpdate       openapi.ErrorResponseCode = "CONCURRENT_UPDATE"
	codeUnsupportedContentType openapi.ErrorResponseCode = "UNSUPPORTED_CONTENT_TYPE"
	codeCatalogNotReady        openapi.ErrorResponseCode = "CATALOG_NOT_READY"
	codeCatalogVersionNotFound openapi.ErrorResponseCode = "CATALOG_VERSION_NOT_FOUND"
	codeInternal               openapi.ErrorResponseCode = "INTERNAL"

	// 多人模式（08 §7.2）
	codeRoomNotFound         openapi.ErrorResponseCode = "ROOM_NOT_FOUND"
	codeRoomFull             openapi.ErrorResponseCode = "ROOM_FULL"
	codeRoomClosed           openapi.ErrorResponseCode = "ROOM_CLOSED"
	codeGuestUnauthorized    openapi.ErrorResponseCode = "GUEST_UNAUTHORIZED"
	codeSpectatorReadOnly    openapi.ErrorResponseCode = "SPECTATOR_READ_ONLY"
	codeInvalidFormat        openapi.ErrorResponseCode = "INVALID_FORMAT"
	codeInvalidPlayerLimit   openapi.ErrorResponseCode = "INVALID_PLAYER_LIMIT"
	codeRoomSettingsLocked   openapi.ErrorResponseCode = "ROOM_SETTINGS_LOCKED"
	codeMatchAlreadyStarted  openapi.ErrorResponseCode = "MATCH_ALREADY_STARTED"
	codeRematchNotAvailable  openapi.ErrorResponseCode = "REMATCH_NOT_AVAILABLE"
	codeRoundNotActive       openapi.ErrorResponseCode = "ROUND_NOT_ACTIVE"
	codeRoundEnded           openapi.ErrorResponseCode = "ROUND_ENDED"
	codeGuessLimitReached    openapi.ErrorResponseCode = "GUESS_LIMIT_REACHED"
	codeNotYourTurn          openapi.ErrorResponseCode = "NOT_YOUR_TURN"
	codeTurnExpired          openapi.ErrorResponseCode = "TURN_EXPIRED"
	codeRateLimited          openapi.ErrorResponseCode = "RATE_LIMITED"
	codeChatMessageInvalid   openapi.ErrorResponseCode = "CHAT_MESSAGE_INVALID"
	codeChatCursorInvalid    openapi.ErrorResponseCode = "CHAT_CURSOR_INVALID"
	codeChatSendForbidden    openapi.ErrorResponseCode = "CHAT_SEND_FORBIDDEN"
	codeChatIdemConflict     openapi.ErrorResponseCode = "CHAT_IDEMPOTENCY_CONFLICT"
	codeChatCursorAhead      openapi.ErrorResponseCode = "CHAT_CURSOR_AHEAD"
	codeChatResyncRequired   openapi.ErrorResponseCode = "CHAT_RESYNC_REQUIRED"
	codeFeatureDisabled      openapi.ErrorResponseCode = "FEATURE_DISABLED"
	codeQuestionPoolTooSmall openapi.ErrorResponseCode = "QUESTION_POOL_TOO_SMALL_FOR_PAIRINGS"
	codeEncounterNotFound    openapi.ErrorResponseCode = "ENCOUNTER_NOT_FOUND"
	codeNotEncounterPlayer   openapi.ErrorResponseCode = "NOT_ENCOUNTER_PLAYER"
	codeEncounterEnded       openapi.ErrorResponseCode = "ENCOUNTER_ENDED"
	codeIdempotencyConflict  openapi.ErrorResponseCode = "IDEMPOTENCY_CONFLICT"
)

func internalError(err error) *ApiError {
	return &ApiError{
		Status:  http.StatusInternalServerError,
		Code:    codeInternal,
		Message: "服务器暂时无法处理请求。",
		cause:   err,
	}
}
