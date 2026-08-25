package handler

import "testing"

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
