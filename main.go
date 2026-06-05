package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

//go:embed static/*
var staticFS embed.FS

// WebhookRequest represents an incoming HTTP request details.
type WebhookRequest struct {
	ID            string              `json:"id"`
	Method        string              `json:"method"`
	Headers       map[string][]string `json:"headers"`
	QueryParams   map[string][]string `json:"query_params"`
	Body          string              `json:"body"`
	ContentLength int64               `json:"content_length"`
	RemoteAddr    string              `json:"remote_addr"`
	ReceivedAt    time.Time           `json:"received_at"`
}

// ResponseConfig represents mock responses configured by user for /w/{token}.
type ResponseConfig struct {
	StatusCode  int    `json:"status_code"`
	ContentType string `json:"content_type"`
	Body        string `json:"body"`
}

// Client represents a streaming connection.
type Client struct {
	ch chan WebhookRequest
}

// TokenStore manages in-memory webhook requests, SSE connections, and custom responses.
type TokenStore struct {
	mu              sync.Mutex
	requests        map[string][]WebhookRequest
	clients         map[string]map[*Client]bool
	responseConfigs map[string]ResponseConfig
}

func NewTokenStore() *TokenStore {
	return &TokenStore{
		requests:        make(map[string][]WebhookRequest),
		clients:         make(map[string]map[*Client]bool),
		responseConfigs: make(map[string]ResponseConfig),
	}
}

// generateToken generates a random hex string for webhook URL endpoints.
func generateToken() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp if crypto rand fails
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func getClientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		ips := strings.Split(ip, ",")
		return strings.TrimSpace(ips[0])
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if parts := strings.Split(r.RemoteAddr, ":"); len(parts) > 0 {
		return parts[0]
	}
	return r.RemoteAddr
}

// AddRequest stores a request and pushes it to all listening SSE clients.
func (s *TokenStore) AddRequest(token string, req WebhookRequest) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Keep last 50 requests
	list := s.requests[token]
	if len(list) >= 50 {
		list = list[1:]
	}
	list = append(list, req)
	s.requests[token] = list

	// Broadcast to active clients for this token
	if clients, exists := s.clients[token]; exists {
		for client := range clients {
			select {
			case client.ch <- req:
			default:
				// Buffer full, skip to avoid blocking the webhook endpoint
			}
		}
	}
}

// GetRequests retrieves the request history for a token.
func (s *TokenStore) GetRequests(token string) []WebhookRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.requests[token]
	if list == nil {
		return []WebhookRequest{}
	}
	copied := make([]WebhookRequest, len(list))
	copy(copied, list)
	return copied
}

// RegisterClient registers a client for SSE updates.
func (s *TokenStore) RegisterClient(token string) *Client {
	s.mu.Lock()
	defer s.mu.Unlock()

	client := &Client{ch: make(chan WebhookRequest, 10)}
	if _, exists := s.clients[token]; !exists {
		s.clients[token] = make(map[*Client]bool)
	}
	s.clients[token][client] = true
	return client
}

// UnregisterClient removes an SSE client connection.
func (s *TokenStore) UnregisterClient(token string, client *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if clients, exists := s.clients[token]; exists {
		delete(clients, client)
		if len(clients) == 0 {
			delete(s.clients, token)
		}
	}
}

// SetResponseConfig saves custom response configs.
func (s *TokenStore) SetResponseConfig(token string, config ResponseConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.responseConfigs[token] = config
}

// GetResponseConfig retrieves response configs (or defaults).
func (s *TokenStore) GetResponseConfig(token string) ResponseConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	config, exists := s.responseConfigs[token]
	if !exists {
		return ResponseConfig{
			StatusCode:  200,
			ContentType: "text/plain",
			Body:        "ok",
		}
	}
	return config
}

// CreateTokenHandler generates a new token.
func (s *TokenStore) CreateTokenHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodOptions {
		return
	}
	token := generateToken()
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// GetRequestsHandler returns history of requests for a token.
func (s *TokenStore) GetRequestsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodOptions {
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}
	token := parts[3]
	requests := s.GetRequests(token)
	json.NewEncoder(w).Encode(requests)
}

// ResponseConfigHandler handles GET (fetch) and POST (save) custom response settings.
func (s *TokenStore) ResponseConfigHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}
	token := parts[3]

	if r.Method == http.MethodPost {
		var config ResponseConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			http.Error(w, "Bad request body", http.StatusBadRequest)
			return
		}
		if config.StatusCode == 0 {
			config.StatusCode = 200
		}
		if config.ContentType == "" {
			config.ContentType = "text/plain"
		}
		s.SetResponseConfig(token, config)
		json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
		return
	}

	// GET response settings
	config := s.GetResponseConfig(token)
	json.NewEncoder(w).Encode(config)
}

// StreamHandler streams requests in real-time.
func (s *TokenStore) StreamHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid stream URL", http.StatusBadRequest)
		return
	}
	token := parts[3]

	client := s.RegisterClient(token)
	defer s.UnregisterClient(token, client)

	// Send initial comment to establish connection
	fmt.Fprintf(w, ": ok\n\n")
	w.(http.Flusher).Flush()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	notify := r.Context().Done()

	for {
		select {
		case req := <-client.ch:
			data, err := json.Marshal(req)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.(http.Flusher).Flush()
		case <-ticker.C:
			// Send heartbeat comment to keep the connection open
			fmt.Fprintf(w, ": keepalive\n\n")
			w.(http.Flusher).Flush()
		case <-notify:
			return
		}
	}
}

// WebhookHandler captures requests sent to /w/{token}.
func (s *TokenStore) WebhookHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 3 {
		http.Error(w, "Invalid webhook URL", http.StatusBadRequest)
		return
	}
	token := parts[2]
	if token == "" {
		http.Error(w, "Token required", http.StatusBadRequest)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading request body", http.StatusInternalServerError)
		return
	}
	bodyStr := string(bodyBytes)

	// Generate a unique ID for the request
	reqID := fmt.Sprintf("req_%d_%s", time.Now().UnixNano(), generateToken()[:4])

	req := WebhookRequest{
		ID:            reqID,
		Method:        r.Method,
		Headers:       r.Header,
		QueryParams:   r.URL.Query(),
		Body:          bodyStr,
		ContentLength: r.ContentLength,
		RemoteAddr:    getClientIP(r),
		ReceivedAt:    time.Now(),
	}

	s.AddRequest(token, req)

	// Retrieve mock response config
	config := s.GetResponseConfig(token)

	w.Header().Set("Content-Type", config.ContentType)
	w.WriteHeader(config.StatusCode)
	w.Write([]byte(config.Body))
}

func main() {
	store := NewTokenStore()

	// Static website serving
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("Error loading embedded static files: %v", err)
	}
	staticServer := http.FileServer(http.FS(subFS))

	// Routes
	http.HandleFunc("/token", store.CreateTokenHandler)
	http.HandleFunc("/api/requests/", store.GetRequestsHandler)
	http.HandleFunc("/api/response/", store.ResponseConfigHandler)
	http.HandleFunc("/api/stream/", store.StreamHandler)
	http.HandleFunc("/w/", store.WebhookHandler)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		staticServer.ServeHTTP(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8345"
	}
	log.Printf("Starting Webhook Tester on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
