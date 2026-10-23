package handler

import (
	"encoding/json"
	"github.com/multica-ai/multica/server/internal/testutil"
	"testing"
)

func TestMCPHistoricalUsageSnapshot(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write", "issues:delete"})
	issue := dbfx.Issue(t, "Imported history")
	input := map[string]any{"id": issue, "source_workspace_id": testWorkspaceID, "source_issue_id": issue, "source_issue_identifier": "OLD-1", "source_name": "Source workspace", "captured_at": "2026-10-23T08:00:00Z", "input_tokens": 120, "output_tokens": 30, "cache_read_tokens": 500, "cache_write_tokens": 0, "task_count": 2}
	imported := mcpOutput(t, mcpTool(t, token, "xteam_issue_usage_import", input))
	if imported["input_tokens"] != float64(120) || imported["coverage"] != nil {
		t.Fatalf("wrong imported summary: %v", imported)
	}
	var localUsage map[string]any
	testutil.Call(t, testHandler.GetIssueUsage, withURLParam(newRequest("GET", "/usage", nil), "id", issue)).Want(200).JSON(&localUsage)
	if localUsage["total_input_tokens"] != float64(0) {
		t.Fatal("import polluted local usage")
	}
	// Repeating a snapshot must replace, not add, and never create a local run.
	mcpOutput(t, mcpTool(t, token, "xteam_issue_usage_import", input))
	input["captured_at"] = "2026-10-23T09:00:00Z"
	input["input_tokens"] = 150
	input["coverage"] = map[string]any{"terminal_task_count": 3, "metered_task_count": 2, "unreported_task_count": 1}
	updated := mcpOutput(t, mcpTool(t, token, "xteam_issue_usage_import", input))
	if updated["input_tokens"] != float64(150) {
		t.Fatal("snapshot added instead of replaced")
	}
	for _, field := range []string{"input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "task_count"} {
		bad := map[string]any{}
		for k, v := range input {
			bad[k] = v
		}
		bad[field] = -1
		if mcpTool(t, token, "xteam_issue_usage_import", bad)["isError"] != true {
			t.Fatalf("negative %s accepted", field)
		}
	}
	input["captured_at"] = "2026-10-23T08:00:00Z"
	if mcpTool(t, token, "xteam_issue_usage_import", input)["isError"] != true {
		t.Fatal("stale snapshot overwrote newer history")
	}
	readOnly, _ := createMCPFixtureKey(t, []string{"issues:read"})
	if mcpTool(t, readOnly, "xteam_issue_usage_import", input)["isError"] != true {
		t.Fatal("read-only key wrote history")
	}
	list := mcpTool(t, readOnly, "xteam_issue_usage_list", map[string]any{"id": issue})
	var rows []map[string]any
	// Decode the real MCP content without relying on its internal DB representation.
	decodeMCPUsageList(t, list, &rows)
	if len(rows) != 1 || rows[0]["input_tokens"] != float64(150) {
		t.Fatalf("wrong snapshot list: %v", rows)
	}
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM agent_task_queue WHERE issue_id=$1", issue).Scan(&count)
	if count != 0 {
		t.Fatal("historical usage fabricated local execution")
	}
	mcpOutput(t, mcpTool(t, token, "xteam_issue_delete", map[string]any{"id": issue, "confirmed": true}))
	dbfx.QueryRow(t, "SELECT count(*) FROM issue_imported_usage WHERE issue_id=$1", issue).Scan(&count)
	if count != 0 {
		t.Fatal("deleted issue left imported usage")
	}
}

func TestMCPHistoricalUsageRejectsForeignIssue(t *testing.T) {
	token, _ := createMCPFixtureKey(t, []string{"issues:read", "issues:write"})
	foreign := dbfx.Workspace(t, "Foreign usage", "foreign-usage")
	issue := dbfx.Issue(t, "Foreign issue", testutil.Cols{"workspace_id": foreign})
	input := map[string]any{"id": issue, "source_workspace_id": "origin", "source_issue_id": "old", "source_issue_identifier": "OLD-1", "source_name": "Origin", "captured_at": "2026-10-23T08:00:00Z", "input_tokens": 1, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "task_count": 1}
	if mcpTool(t, token, "xteam_issue_usage_import", input)["isError"] != true {
		t.Fatal("foreign usage write allowed")
	}
	if mcpTool(t, token, "xteam_issue_usage_list", map[string]any{"id": issue})["isError"] != true {
		t.Fatal("foreign usage read allowed")
	}
}

func decodeMCPUsageList(t *testing.T, result map[string]any, rows *[]map[string]any) {
	t.Helper()
	if result["isError"] == true {
		t.Fatalf("usage list failed: %v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if err := json.Unmarshal([]byte(text), rows); err != nil {
		t.Fatal(err)
	}
}

func TestHistoricalUsageWorkspaceCleanupAndCoverageValidation(t *testing.T) {
	workspace := dbfx.Workspace(t, "History cleanup", "history-cleanup")
	dbfx.Member(t, workspace, testUserID, "owner")
	request := newRequest("POST", "/keys", map[string]any{"name": "history cleanup", "workspace_id": workspace, "scopes": []string{"issues:read", "issues:write"}})
	var key map[string]any
	testutil.Call(t, testHandler.CreateMCPKey, request).Want(201).JSON(&key)
	token := key["token"].(string)
	issue := mcpOutput(t, mcpTool(t, token, "xteam_issue_create", map[string]any{"request_id": "history-cleanup", "title": "History cleanup"}))
	input := map[string]any{"id": issue["id"], "source_workspace_id": "source", "source_issue_id": "source-issue", "source_issue_identifier": "OLD-1", "source_name": "Origin", "captured_at": "2026-10-23T08:00:00Z", "input_tokens": 1, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "task_count": 1}
	mcpOutput(t, mcpTool(t, token, "xteam_issue_usage_import", input))
	input["coverage"] = map[string]any{"terminal_task_count": 1, "metered_task_count": 2, "unreported_task_count": 0}
	if mcpTool(t, token, "xteam_issue_usage_import", input)["isError"] != true {
		t.Fatal("inconsistent coverage accepted")
	}
	delete(input, "coverage")
	input["input_tokens"] = 2
	if mcpTool(t, token, "xteam_issue_usage_import", input)["isError"] != true {
		t.Fatal("same-time conflicting snapshot accepted")
	}
	input["captured_at"] = "not a time"
	if mcpTool(t, token, "xteam_issue_usage_import", input)["isError"] != true {
		t.Fatal("invalid time accepted")
	}
	deletion := withURLParam(newRequest("DELETE", "/workspace", nil), "id", workspace)
	testutil.Call(t, testHandler.DeleteWorkspace, deletion).Want(204)
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM issue_imported_usage WHERE workspace_id=$1", workspace).Scan(&count)
	if count != 0 {
		t.Fatal("workspace left imported history")
	}
}
