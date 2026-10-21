package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestProjectContextLifecycle(t *testing.T) {
	projectID := dbfx.Project(t, "Context fixture")
	t.Cleanup(func() {
		testPool.Exec(context.Background(), "DELETE FROM project_context WHERE project_id=$1", projectID)
	})
	request := func(method string, body any) *http.Request {
		return withURLParam(newRequest(method, "/api/projects/"+projectID+"/context", body), "id", projectID)
	}
	var initial map[string]any
	testutil.Call(t, testHandler.GetProjectContext, request("GET", nil)).Want(200).JSON(&initial)
	payload := map[string]any{"revision": initial["revision"], "reading_notes": "Read requirements before code", "entrypoint": map[string]any{"name": "Start here", "location": "https://github.com/example/product/blob/main/AGENTS.md", "kind": "url"}, "sections": map[string]any{"requirements": map[string]any{"references": []any{map[string]any{"name": "Requirements", "location": "https://github.com/example/product/tree/main/docs", "kind": "url", "version": "main"}}}, "lessons": map[string]any{"not_applicable": true}}}
	var saved map[string]any
	testutil.Call(t, testHandler.UpdateProjectContext, request("PUT", payload)).Want(200).JSON(&saved)
	if saved["reading_notes"] != "Read requirements before code" {
		t.Fatal(saved)
	}
	var reread map[string]any
	testutil.Call(t, testHandler.GetProjectContext, request("GET", nil)).Want(200).JSON(&reread)
	if reread["revision"] != saved["revision"] {
		t.Fatal("not persisted")
	}
	testutil.Call(t, testHandler.UpdateProjectContext, request("PUT", payload)).Want(409)
	outsider := dbfx.User(t, "Other user", "context-other@example.test")
	req := request("GET", nil)
	req.Header.Set("X-User-ID", outsider)
	testutil.Call(t, testHandler.GetProjectContext, req).Want(404)
	member := dbfx.User(t, "Reader", "context-reader@example.test")
	dbfx.Member(t, testWorkspaceID, member, "member")
	req = request("GET", nil)
	req.Header.Set("X-User-ID", member)
	testutil.Call(t, testHandler.GetProjectContext, req).Want(200)
	req = request("PUT", payload)
	req.Header.Set("X-User-ID", member)
	testutil.Call(t, testHandler.UpdateProjectContext, req).Want(403)
	otherWorkspace := dbfx.Workspace(t, "Other workspace", "context-other")
	req = request("GET", nil)
	req.Header.Set("X-Workspace-ID", otherWorkspace)
	testutil.Call(t, testHandler.GetProjectContext, req).Want(404)
}

func TestProjectContextRejectsUnsafeSources(t *testing.T) {
	projectID := dbfx.Project(t, "Unsafe source fixture")
	for _, location := range []string{"javascript:alert(1)", "https://user:secret@example.com/docs", "https://example.com/?token=secret", "file:///Users/test/LESSONS.md"} {
		t.Run(location, func(t *testing.T) {
			req := withURLParam(newRequest("PUT", "/context", map[string]any{"entrypoint": map[string]any{"name": "Unsafe", "location": location, "kind": "url"}}), "id", projectID)
			testutil.Call(t, testHandler.UpdateProjectContext, req).Want(400)
		})
	}
}

func TestProjectContextKeepsExecutionResourcesAndCleansDeletedProject(t *testing.T) {
	projectID := dbfx.Project(t, "Context resource isolation")
	dbfx.Insert(t, "project_resource", testutil.Cols{"project_id": projectID, "workspace_id": testWorkspaceID, "resource_type": "github_repo", "resource_ref": `{"url":"https://github.com/example/product","ref":"main"}`})
	request := func(method string, body any) *http.Request {
		return withURLParam(newRequest(method, "/context", body), "id", projectID)
	}
	document := map[string]any{"revision": 0, "sections": map[string]any{"code": map[string]any{"references": []any{map[string]any{"name": "Local source", "kind": "path", "location": "/workspace/product"}}}}}
	testutil.Call(t, testHandler.UpdateProjectContext, request("PUT", document)).Want(200)
	testutil.Call(t, testHandler.UpdateProjectContext, request("PUT", map[string]any{"revision": 1})).Want(200)
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM project_resource WHERE project_id=$1", projectID).Scan(&count)
	if count != 1 {
		t.Fatal("context edits changed execution resources")
	}
	testutil.Call(t, testHandler.DeleteProject, request("DELETE", nil)).Want(204)
	dbfx.QueryRow(t, "SELECT count(*) FROM project_context WHERE project_id=$1", projectID).Scan(&count)
	if count != 0 {
		t.Fatal("deleted project leaked its context")
	}
}

func TestProjectContextRejectsInvalidDocumentWithoutPartialSave(t *testing.T) {
	projectID := dbfx.Project(t, "Context validation")
	for _, document := range []map[string]any{
		{"sections": map[string]any{"unknown": map[string]any{}}},
		{"sections": map[string]any{"design": map[string]any{"not_applicable": true, "references": []any{map[string]any{"name": "Conflicting", "kind": "url", "location": "https://example.com"}}}}},
		{"entrypoint": map[string]any{"name": "", "kind": "url", "location": "https://example.com"}},
	} {
		request := withURLParam(newRequest("PUT", "/context", document), "id", projectID)
		testutil.Call(t, testHandler.UpdateProjectContext, request).Want(400)
	}
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM project_context WHERE project_id=$1", projectID).Scan(&count)
	if count != 0 {
		t.Fatal("invalid document was partially saved")
	}
}

func TestProjectContextWorkspaceDeleteCleansReferences(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Context cleanup", "context-cleanup")
	dbfx.Member(t, workspaceID, testUserID, "owner")
	projectID := dbfx.Project(t, "Workspace cleanup context", testutil.Cols{"workspace_id": workspaceID})
	request := withURLParam(newRequest("PUT", "/context", map[string]any{"revision": 0, "reading_notes": "Temporary fixture"}), "id", projectID)
	request.Header.Set("X-Workspace-ID", workspaceID)
	testutil.Call(t, testHandler.UpdateProjectContext, request).Want(200)
	deletion := withURLParam(newRequest("DELETE", "/workspace", nil), "id", workspaceID)
	testutil.Call(t, testHandler.DeleteWorkspace, deletion).Want(204)
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM project_context WHERE project_id=$1", projectID).Scan(&count)
	if count != 0 {
		t.Fatal("deleted workspace left orphan context")
	}
}
