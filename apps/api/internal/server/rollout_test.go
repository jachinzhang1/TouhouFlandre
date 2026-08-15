package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

func rolloutRequest(t *testing.T, client *http.Client, baseURL, method, path, token string, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer guest:"+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

func createRolloutRoom(t *testing.T, client *http.Client, baseURL string) openapi.CreateRoomResponse {
	t.Helper()
	resp, payload := rolloutRequest(t, client, baseURL, http.MethodPost, "/api/rooms", "", map[string]string{"format": "bo3"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create rollout room: %d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatalf("decode create response: %v (%s)", err, payload)
	}
	return created
}

func disabledRolloutServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(server.NewWithOptions(pool,
		handler.WithJoinRateLimit(10000, time.Minute),
		handler.WithRolloutConfig(handler.RolloutConfig{})))
}

func TestRolloutDisablesNPlayerCreationAndSettings(t *testing.T) {
	ts := disabledRolloutServer(t)
	defer ts.Close()

	resp, payload := rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format":      "bo3",
		"mode":        "race",
		"playerLimit": 3,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("disabled N-player create: %d %s", resp.StatusCode, payload)
	}
	if code := decodeError(t, payload).Code; code != "INVALID_PLAYER_LIMIT" {
		t.Fatalf("disabled N-player create code=%s", code)
	}

	created := createRolloutRoom(t, ts.Client(), ts.URL)
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPatch, "/api/rooms/"+created.RoomId+"/settings", string(created.GuestToken), map[string]int{"playerLimit": 3})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("disabled N-player settings: %d %s", resp.StatusCode, payload)
	}
	if code := decodeError(t, payload).Code; code != "INVALID_PLAYER_LIMIT" {
		t.Fatalf("disabled N-player settings code=%s", code)
	}
}

func TestRolloutDisablesChatSendButKeepsHistoryReadable(t *testing.T) {
	ts := disabledRolloutServer(t)
	defer ts.Close()

	created := createRolloutRoom(t, ts.Client(), ts.URL)
	resp, payload := rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms/"+created.RoomId+"/messages", string(created.GuestToken), map[string]string{
		"clientMessageId": "00000000-0000-4000-8000-000000000001",
		"kind":            "text",
		"content":         "hello",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("disabled chat send: %d %s", resp.StatusCode, payload)
	}
	if code := decodeError(t, payload).Code; code != "CHAT_SEND_FORBIDDEN" {
		t.Fatalf("disabled chat send code=%s", code)
	}

	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodGet, "/api/rooms/"+created.RoomId+"/messages", string(created.GuestToken), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("chat history should remain readable: %d %s", resp.StatusCode, payload)
	}
}
