package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestMCPKeyCannotAccessOrdinaryAPI(t *testing.T) {
	body, _ := json.Marshal(map[string]any{"name": "MCP integration", "workspace_id": testWorkspaceID, "scopes": []string{"issues:read"}, "expires_in_days": 7})
	request, _ := http.NewRequest("POST", testServer.URL+"/api/mcp-keys", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+testToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatalf("create status %d", response.StatusCode)
	}
	var key struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { testPool.Exec(context.Background(), "DELETE FROM mcp_key WHERE id=$1", key.ID) })
	for _, path := range []string{"/api/me", "/api/tokens", "/api/issues", "/api/mcp-keys"} {
		req, _ := http.NewRequest("GET", testServer.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+key.Token)
		req.Header.Set("X-Workspace-ID", testWorkspaceID)
		result, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		result.Body.Close()
		if result.StatusCode != 401 {
			t.Fatalf("MCP key accessed %s: %d", path, result.StatusCode)
		}
	}
	request, _ = http.NewRequest("POST", testServer.URL+"/mcp", bytes.NewBufferString(`{}`))
	request.Header.Set("Authorization", "Bearer "+testToken)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatalf("ordinary token accessed MCP: %d", response.StatusCode)
	}
}
