package handler

import (
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestIssueConclusionPersists(t *testing.T) {
	id := dbfx.Issue(t, "Conclusion fixture")
	get := func() map[string]any {
		t.Helper()
		var out map[string]any
		testutil.Call(t, testHandler.GetIssue, withURLParam(newRequest("GET", "/api/issues/"+id, nil), "id", id)).Want(http.StatusOK).JSON(&out)
		return out
	}
	if got := get()["conclusion"]; got != "" {
		t.Fatalf("default conclusion = %#v, want empty string", got)
	}
	for _, value := range []string{"已验收\n可上线", ""} {
		var out map[string]any
		testutil.Call(t, testHandler.UpdateIssue, withURLParam(newRequest("PUT", "/api/issues/"+id, map[string]any{"conclusion": value}), "id", id)).Want(http.StatusOK).JSON(&out)
		if out["conclusion"] != value {
			t.Fatalf("update conclusion = %#v, want %q", out["conclusion"], value)
		}
		if get()["conclusion"] != value {
			t.Fatalf("fresh GET did not retain conclusion %q", value)
		}
	}
}

func TestIssueConclusionRejectsMalformed(t *testing.T) {
	id := dbfx.Issue(t, "Malformed conclusion")
	for _, value := range []any{42, true, map[string]any{"text": "bad"}} {
		testutil.Call(t, testHandler.UpdateIssue, withURLParam(newRequest("PUT", "/api/issues/"+id, map[string]any{"conclusion": value}), "id", id)).Want(http.StatusBadRequest)
	}
}

func TestIssueConclusionWorkspacePermission(t *testing.T) {
	foreign := dbfx.Insert(t, "workspace", testutil.Cols{"name": "Foreign conclusion", "slug": "foreign-conclusion"})
	id := dbfx.Issue(t, "Foreign conclusion", testutil.Cols{"workspace_id": foreign})
	testutil.Call(t, testHandler.UpdateIssue, withURLParam(newRequest("PUT", "/api/issues/"+id, map[string]any{"conclusion": "unauthorized"}), "id", id)).Want(http.StatusNotFound)
}
