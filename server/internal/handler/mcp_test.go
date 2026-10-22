package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/testutil"
)

func createMCPFixtureKey(t *testing.T, scopes []string) (string, string) {
	t.Helper()
	request := newRequest("POST", "/api/mcp-keys", map[string]any{"name": "MCP fixture", "workspace_id": testWorkspaceID, "scopes": scopes, "expires_in_days": 30})
	var key map[string]any
	testutil.Call(t, testHandler.CreateMCPKey, request).Want(201).JSON(&key)
	id, _ := key["id"].(string)
	token, _ := key["token"].(string)
	if !strings.HasPrefix(token, "xtm_") {
		t.Fatal("missing MCP-specific token")
	}
	t.Cleanup(func() {
		dbfx.Exec(t, "DELETE FROM mcp_issue_request WHERE key_id=$1", id)
		dbfx.Exec(t, "DELETE FROM mcp_key WHERE id=$1", id)
	})
	return token, id
}
func mcpCall(t *testing.T, token, method string, params any) map[string]any {
	t.Helper()
	req := testutil.JSONRequest("POST", "http://localhost/mcp", map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	var response map[string]any
	testutil.Call(t, testHandler.ServeMCP, req).Want(200).JSON(&response)
	return response
}
func mcpTool(t *testing.T, token, name string, args any) map[string]any {
	t.Helper()
	reply := mcpCall(t, token, "tools/call", map[string]any{"name": name, "arguments": args})
	result, ok := reply["result"].(map[string]any)
	if !ok {
		t.Fatalf("protocol error: %v", reply)
	}
	return result
}
func mcpOutput(t *testing.T, result map[string]any) map[string]any {
	t.Helper()
	if result["isError"] == true {
		t.Fatalf("tool failed: %v", result)
	}
	content := result["content"].([]any)[0].(map[string]any)["text"].(string)
	var output map[string]any
	if err := json.Unmarshal([]byte(content), &output); err != nil {
		t.Fatal(err)
	}
	return output
}
func TestMCPKeyAndProtocol(t *testing.T) {
	token, id := createMCPFixtureKey(t, []string{"issues:read"})
	var listed []map[string]any
	testutil.Call(t, testHandler.ListMCPKeys, newRequest("GET", "/api/mcp-keys", nil)).Want(200).JSON(&listed)
	found := false
	for _, key := range listed {
		if key["id"] == id {
			found = true
			if _, ok := key["token"]; ok {
				t.Fatal("list leaked secret")
			}
		}
	}
	if !found {
		t.Fatal("key missing")
	}
	init := mcpCall(t, token, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "fixture", "version": "1"}})
	if init["result"] == nil {
		t.Fatal(init)
	}
	identity := mcpOutput(t, mcpTool(t, token, "xteam_identity", map[string]any{}))
	if identity["workspace_id"] != testWorkspaceID {
		t.Fatal(identity)
	}
	testutil.Call(t, testHandler.RevokeMCPKey, withURLParam(newRequest("DELETE", "/keys/"+id, nil), "id", id)).Want(204)
	req := testutil.JSONRequest("POST", "/mcp", `{}`)
	req.Header.Set("Authorization", "Bearer "+token)
	testutil.Call(t, testHandler.ServeMCP, req).Want(401)
}
func TestMCPIssueCRUDAndIdempotency(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write", "issues:delete"})
	args := map[string]any{"request_id": "create-one", "title": "MCP create fixture", "description": "fixture"}
	created := mcpOutput(t, mcpTool(t, token, "xteam_issue_create", args))
	id := created["id"].(string)
	t.Cleanup(func() { dbfx.Exec(t, "DELETE FROM issue WHERE id=$1", id) })
	replay := mcpOutput(t, mcpTool(t, token, "xteam_issue_create", args))
	if replay["id"] != id {
		t.Fatal("retry duplicated issue")
	}
	changed := mcpTool(t, token, "xteam_issue_create", map[string]any{"request_id": "create-one", "title": "different"})
	if changed["isError"] != true {
		t.Fatal("reused request accepted different payload")
	}
	updated := mcpOutput(t, mcpTool(t, token, "xteam_issue_update", map[string]any{"id": id, "changes": map[string]any{"title": "Edited MCP fixture"}}))
	if updated["title"] != "Edited MCP fixture" {
		t.Fatal(updated)
	}
	got := mcpOutput(t, mcpTool(t, token, "xteam_issue_get", map[string]any{"id": id}))
	if got["id"] != id {
		t.Fatal(got)
	}
	mcpOutput(t, mcpTool(t, token, "xteam_issue_list", map[string]any{"limit": 10}))
	mcpOutput(t, mcpTool(t, token, "xteam_issue_search", map[string]any{"query": "Edited MCP", "limit": 10}))
	unconfirmed := mcpTool(t, token, "xteam_issue_delete", map[string]any{"id": id})
	if unconfirmed["isError"] != true {
		t.Fatal("delete without confirmation accepted")
	}
	mcpOutput(t, mcpTool(t, token, "xteam_issue_delete", map[string]any{"id": id, "confirmed": true}))
}
func TestMCPRejectsScopeExpiryAndMembershipLoss(t *testing.T) {
	token, id := createMCPFixtureKey(t, []string{"issues:read"})
	result := mcpTool(t, token, "xteam_issue_create", map[string]any{"request_id": "denied", "title": "Must not exist"})
	if result["isError"] != true {
		t.Fatal(result)
	}
	dbfx.Exec(t, "UPDATE mcp_key SET expires_at=now()-interval '1 second' WHERE id=$1", id)
	req := testutil.JSONRequest("POST", "/mcp", `{}`)
	req.Header.Set("Authorization", "Bearer "+token)
	testutil.Call(t, testHandler.ServeMCP, req).Want(401)
}
func TestMCPRejectsForgedWorkspaceAndUnsupportedWrites(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write"})
	foreign := dbfx.Workspace(t, "Foreign MCP", "foreign-mcp")
	issue := dbfx.Issue(t, "Foreign issue", testutil.Cols{"workspace_id": foreign})
	if mcpTool(t, token, "xteam_issue_get", map[string]any{"id": issue})["isError"] != true {
		t.Fatal("cross workspace read succeeded")
	}
	result := mcpTool(t, token, "xteam_issue_create", map[string]any{"request_id": "no-dispatch", "title": "Forbidden dispatch", "assignee_type": "agent"})
	if result["isError"] != true {
		t.Fatal("unsupported write accepted")
	}
}

func TestMCPDiscoveryProvidesCallableSchemas(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read"})
	reply := mcpCall(t, token, "tools/list", map[string]any{})
	tools := reply["result"].(map[string]any)["tools"].([]any)
	for _, raw := range tools {
		tool := raw.(map[string]any)
		schema := tool["inputSchema"].(map[string]any)
		if tool["name"] == "xteam_issue_create" {
			properties, _ := schema["properties"].(map[string]any)
			if properties["title"] == nil || properties["request_id"] == nil {
				t.Fatal("create tool has no discoverable arguments")
			}
		}
	}
}
func TestMCPRejectsKeyAfterMemberLeaves(t *testing.T) {
	token, id := createMCPFixtureKey(t, []string{"issues:read"})
	outsider := dbfx.User(t, "Former member", "mcp-former@example.test")
	dbfx.Exec(t, "UPDATE mcp_key SET user_id=$1 WHERE id=$2", outsider, id)
	req := testutil.JSONRequest("POST", "/mcp", `{}`)
	req.Header.Set("Authorization", "Bearer "+token)
	testutil.Call(t, testHandler.ServeMCP, req).Want(401)
}

func TestMCPRejectsBadKeyInputs(t *testing.T) {
	for _, body := range []map[string]any{
		{"name": "test", "workspace_id": testWorkspaceID, "scopes": []string{"issues:read", "admin"}},
		{"name": "test", "workspace_id": testWorkspaceID, "scopes": []string{"issues:read"}, "expires_in_days": 365},
		{"name": "test", "workspace_id": testWorkspaceID, "scopes": []string{"issues:write"}},
	} {
		testutil.Call(t, testHandler.CreateMCPKey, newRequest("POST", "/keys", body)).Want(400)
	}
	foreign := dbfx.Workspace(t, "MCP denied", "mcp-key-denied")
	testutil.Call(t, testHandler.CreateMCPKey, newRequest("POST", "/keys", map[string]any{"name": "foreign", "workspace_id": foreign, "scopes": []string{"issues:read"}})).Want(404)
}

type mcpFixtureTransport struct{ token string }

func (transport mcpFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	copy := request.Clone(request.Context())
	copy.Header.Set("Authorization", "Bearer "+transport.token)
	return http.DefaultTransport.RoundTrip(copy)
}
func TestMCPNativeSDKClient(t *testing.T) {
	token, id := createMCPFixtureKey(t, []string{"issues:read"})
	server := httptest.NewServer(http.HandlerFunc(testHandler.ServeMCP))
	defer server.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "codex-compatible-fixture", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: server.URL, HTTPClient: &http.Client{Transport: mcpFixtureTransport{token}}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil || len(tools.Tools) != 7 {
		t.Fatalf("tools: %v %v", tools, err)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "xteam_identity", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatalf("identity: %v %v", result, err)
	}
	dbfx.Exec(t, "UPDATE mcp_key SET revoked=true WHERE id=$1", id)
	_, err = session.CallTool(context.Background(), &mcp.CallToolParams{Name: "xteam_identity", Arguments: map[string]any{}})
	if err == nil {
		t.Fatal("reused SDK client retained revoked access")
	}
}

func TestMCPConcurrentCreateHasOneIssueAndNoRun(t *testing.T) {
	token, id := createMCPFixtureKey(t, []string{"issues:read", "issues:write"})
	key, err := testHandler.Queries.GetMCPKeyByHash(context.Background(), auth.HashToken(token))
	if err != nil {
		t.Fatal(err)
	}
	principal := mcpPrincipal{Key: key}
	arguments := json.RawMessage(`{"request_id":"concurrent","title":"MCP concurrent fixture"}`)
	results := make(chan any, 2)
	errors := make(chan error, 2)
	for index := 0; index < 2; index++ {
		go func() {
			result, err := testHandler.callMCPTool(context.Background(), principal, "xteam_issue_create", arguments)
			results <- result
			errors <- err
		}()
	}
	first := <-results
	second := <-results
	for index := 0; index < 2; index++ {
		if err := <-errors; err != nil {
			t.Fatal(err)
		}
	}
	issueID := first.(map[string]any)["id"].(string)
	t.Cleanup(func() { dbfx.Exec(t, "DELETE FROM issue WHERE id=$1", issueID) })
	if second.(map[string]any)["id"] != issueID {
		t.Fatal("concurrent retry created duplicate")
	}
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM mcp_issue_request WHERE key_id=$1 AND request_id='concurrent'", id).Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	dbfx.QueryRow(t, "SELECT count(*) FROM agent_task_queue WHERE issue_id=$1", issueID).Scan(&count)
	if count != 0 {
		t.Fatal("ordinary create started an agent task")
	}
}

func TestMCPDeleteNeedsScopeAndDoesNotTrustActorHeaders(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write"})
	issue := dbfx.Issue(t, "MCP delete protection")
	denied := mcpTool(t, token, "xteam_issue_delete", map[string]any{"id": issue, "confirmed": true})
	if denied["isError"] != true {
		t.Fatal("delete succeeded without scope")
	}
	req := testutil.JSONRequest("POST", "http://localhost/mcp", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "xteam_identity", "arguments": map[string]any{}}})
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-User-ID", "forged")
	req.Header.Set("X-Workspace-ID", "forged")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	var result map[string]any
	testutil.Call(t, testHandler.ServeMCP, req).Want(200).JSON(&result)
	identity := mcpOutput(t, result["result"].(map[string]any))
	if identity["user_id"] != testUserID || identity["workspace_id"] != testWorkspaceID {
		t.Fatal("client actor headers were trusted")
	}
	req.Header.Set("Origin", "https://untrusted.example")
	testutil.Call(t, testHandler.ServeMCP, req).Want(403)
}

func TestMCPStatusUpdateDoesNotStartAssignedAgent(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write"})
	runtime := dbfx.Runtime(t, "MCP task isolation runtime")
	agent := dbfx.Agent(t, "MCP assigned agent", runtime)
	issue := dbfx.Issue(t, "MCP parked issue", testutil.Cols{"status": "backlog", "assignee_type": "agent", "assignee_id": agent})
	mcpOutput(t, mcpTool(t, token, "xteam_issue_update", map[string]any{"id": issue, "changes": map[string]any{"status": "todo"}}))
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM agent_task_queue WHERE issue_id=$1", issue).Scan(&count)
	if count != 0 {
		t.Fatal("MCP status update dispatched assigned agent")
	}
}

func TestMCPWorkspaceDeleteCleansKeysAndReceipts(t *testing.T) {
	workspace := dbfx.Workspace(t, "MCP cleanup", "mcp-cleanup")
	dbfx.Member(t, workspace, testUserID, "owner")
	request := newRequest("POST", "/keys", map[string]any{"name": "cleanup", "workspace_id": workspace, "scopes": []string{"issues:read", "issues:write"}})
	var key map[string]any
	testutil.Call(t, testHandler.CreateMCPKey, request).Want(201).JSON(&key)
	issue := mcpOutput(t, mcpTool(t, key["token"].(string), "xteam_issue_create", map[string]any{"request_id": "cleanup", "title": "MCP cleanup issue"}))
	// Remove the issue through its business handler; receipt intentionally remains
	// until workspace teardown so a retry cannot recreate a deleted issue.
	deletion := withURLParam(newRequest("DELETE", "/issue", nil), "id", issue["id"].(string))
	deletion.Header.Set("X-Workspace-ID", workspace)
	testutil.Call(t, testHandler.DeleteIssue, deletion).Want(204)
	testutil.Call(t, testHandler.DeleteWorkspace, withURLParam(newRequest("DELETE", "/workspace", nil), "id", workspace)).Want(204)
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM mcp_key WHERE workspace_id=$1", workspace).Scan(&count)
	if count != 0 {
		t.Fatal("workspace left MCP keys")
	}
	dbfx.QueryRow(t, "SELECT count(*) FROM mcp_issue_request WHERE key_id=$1", key["id"]).Scan(&count)
	if count != 0 {
		t.Fatal("workspace left retry receipts")
	}
}

func TestMCPRejectsForeignProjectWrites(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write"})
	foreign := dbfx.Workspace(t, "MCP foreign project", "mcp-foreign-project")
	project := dbfx.Project(t, "Foreign project", testutil.Cols{"workspace_id": foreign})
	result := mcpTool(t, token, "xteam_issue_create", map[string]any{"request_id": "foreign-project", "title": "Must not be created", "project_id": project})
	if result["isError"] != true {
		t.Fatal("foreign project create succeeded")
	}
	issue := dbfx.Issue(t, "MCP project protection")
	result = mcpTool(t, token, "xteam_issue_update", map[string]any{"id": issue, "changes": map[string]any{"project_id": project}})
	if result["isError"] != true {
		t.Fatal("foreign project update succeeded")
	}
}
