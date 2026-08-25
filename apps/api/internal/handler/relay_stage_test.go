package handler

import (
	"errors"
	"testing"
)

func TestRelayStageHistoryCursorBindsMatchAndUsesStableIndex(t *testing.T) {
	cursor, err := encodeRelayStageHistoryCursor(3, 12)
	if err != nil {
		t.Fatal(err)
	}
	after, apiErr := decodeRelayStageHistoryCursor(&cursor, 3)
	if apiErr != nil || after != 12 {
		t.Fatalf("decoded cursor=%d err=%v", after, apiErr)
	}
	if _, apiErr := decodeRelayStageHistoryCursor(&cursor, 4); apiErr == nil {
		t.Fatal("cursor from another match was accepted")
	}
}

func TestInternalErrorPreservesCauseButRedactsPublicMessage(t *testing.T) {
	cause := errors.New("mrx013-unrevealed-answer-sentinel")
	apiErr := internalError(cause)
	if !errors.Is(apiErr, cause) {
		t.Fatal("internal error did not preserve its cause")
	}
	if apiErr.Message == cause.Error() || apiErr.Response().Error == cause.Error() {
		t.Fatal("internal cause was exposed in the public error")
	}
}

func TestRelayStageHistoryCursorRejectsMalformedValues(t *testing.T) {
	for _, value := range []string{"%", "e30", "eyJ2IjoxLCJtYXRjaEluZGV4IjozLCJhZnRlclN0YWdlSW5kZXgiOiIxIn0"} {
		value := value
		t.Run(value, func(t *testing.T) {
			if _, apiErr := decodeRelayStageHistoryCursor(&value, 3); apiErr == nil {
				t.Fatal("malformed cursor was accepted")
			}
		})
	}
}
