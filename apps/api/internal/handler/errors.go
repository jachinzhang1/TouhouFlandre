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
}

func (e *ApiError) Error() string { return e.Message }

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
	codeInternal               openapi.ErrorResponseCode = "INTERNAL"
)

func internalError(err error) *ApiError {
	return &ApiError{Status: http.StatusInternalServerError, Code: codeInternal, Message: err.Error()}
}
