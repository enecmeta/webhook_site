package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTokenGeneration(t *testing.T) {
	tok1 := generateToken()
	tok2 := generateToken()
	if tok1 == tok2 {
		t.Errorf("Tokens should be unique, got %s and %s", tok1, tok2)
	}
	if len(tok1) != 16 { // 8 bytes = 16 hex chars
		t.Errorf("Expected token length of 16, got %d", len(tok1))
	}
}

func TestStoreAndWebhookCapturing(t *testing.T) {
	store := NewTokenStore()
	token := "testtoken"

	// 1. Initial requests count
	if len(store.GetRequests(token)) != 0 {
		t.Errorf("Expected 0 requests, got %d", len(store.GetRequests(token)))
	}

	// 2. Set response config
	config := ResponseConfig{
		StatusCode:  201,
		ContentType: "application/json",
		Body:        `{"status":"created"}`,
	}
	store.SetResponseConfig(token, config)

	// 3. Capture request
	reqBody := `{"ping":"pong"}`
	req := httptest.NewRequest("POST", "/w/"+token, strings.NewReader(reqBody))
	w := httptest.NewRecorder()

	store.WebhookHandler(w, req)

	// Verify custom config returned
	if w.Code != 201 {
		t.Errorf("Expected status code 201, got %d", w.Code)
	}
	if w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("Expected Content-Type 'application/json', got '%s'", w.Header().Get("Content-Type"))
	}
	if w.Body.String() != `{"status":"created"}` {
		t.Errorf("Expected body '{\"status\":\"created\"}', got '%s'", w.Body.String())
	}

	// 4. Verify request was stored
	reqs := store.GetRequests(token)
	if len(reqs) != 1 {
		t.Fatalf("Expected 1 request stored, got %d", len(reqs))
	}

	storedReq := reqs[0]
	if storedReq.Method != "POST" {
		t.Errorf("Expected method POST, got %s", storedReq.Method)
	}
	if storedReq.Body != reqBody {
		t.Errorf("Expected stored body '%s', got '%s'", reqBody, storedReq.Body)
	}
}

func TestResponseConfigAPI(t *testing.T) {
	store := NewTokenStore()
	token := "apittoken"

	// 1. Save config via handler
	newConfig := ResponseConfig{
		StatusCode:  202,
		ContentType: "text/html",
		Body:        "<h1>Accepted</h1>",
	}
	jsonBytes, _ := json.Marshal(newConfig)
	req := httptest.NewRequest("POST", "/api/response/"+token, bytes.NewReader(jsonBytes))
	w := httptest.NewRecorder()

	store.ResponseConfigHandler(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200 from response API update, got %d", w.Code)
	}

	// 2. Fetch config via handler
	reqFetch := httptest.NewRequest("GET", "/api/response/"+token, nil)
	wFetch := httptest.NewRecorder()

	store.ResponseConfigHandler(wFetch, reqFetch)

	var fetchedConfig ResponseConfig
	json.NewDecoder(wFetch.Body).Decode(&fetchedConfig)

	if fetchedConfig.StatusCode != 202 {
		t.Errorf("Expected status 202, got %d", fetchedConfig.StatusCode)
	}
	if fetchedConfig.ContentType != "text/html" {
		t.Errorf("Expected content type 'text/html', got '%s'", fetchedConfig.ContentType)
	}
	if fetchedConfig.Body != "<h1>Accepted</h1>" {
		t.Errorf("Expected body '<h1>Accepted</h1>', got '%s'", fetchedConfig.Body)
	}
}
