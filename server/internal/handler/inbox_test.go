package handler

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func inboxRequest(method, path, workspaceID string) *http.Request {
	return testutil.WithHeaders(
		testutil.JSONRequest(method, path, nil),
		"X-User-ID", testUserID,
		"X-Workspace-ID", workspaceID,
	)
}

func inboxWorkspaceHandler(handler http.HandlerFunc) http.HandlerFunc {
	return middleware.RequireWorkspaceMember(testHandler.Queries)(handler).ServeHTTP
}

func TestListInboxProjectsCurrentIssueStatusAndPriority(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Inbox filter projections", "inbox-filter-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	issueID := dbfx.Issue(t, "Filtered issue", testutil.Cols{
		"workspace_id": workspaceID,
		"status":       "in_review",
		"priority":     "high",
	})
	dbfx.Insert(t, "inbox_item", testutil.Cols{
		"workspace_id":   workspaceID,
		"recipient_type": "member",
		"recipient_id":   testUserID,
		"type":           "status_changed",
		"severity":       "info",
		"issue_id":       issueID,
		"title":          "Projected issue",
	})

	var items []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListInbox),
		inboxRequest(http.MethodGet, "/api/inbox", workspaceID)).
		Want(http.StatusOK).
		JSON(&items)

	if len(items) != 1 {
		t.Fatalf("inbox items = %d, want 1: %+v", len(items), items)
	}
	if items[0].IssueStatus == nil || *items[0].IssueStatus != "in_review" {
		t.Errorf("issue_status = %v, want in_review", items[0].IssueStatus)
	}
	if items[0].IssuePriority == nil || *items[0].IssuePriority != "high" {
		t.Errorf("issue_priority = %v, want high", items[0].IssuePriority)
	}
}

func TestListArchivedInboxLimitsIssueGroupsNotRows(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Archived inbox groups", "archived-groups-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	noisyIssueID := dbfx.Issue(t, "Noisy archived issue", testutil.Cols{"workspace_id": workspaceID})
	olderIssueID := dbfx.Issue(t, "Older archived issue", testutil.Cols{"workspace_id": workspaceID})

	base := time.Now().UTC().Add(-time.Minute)
	// 200 rows in one statement. The oldest (i = 199) carries the comment
	// anchor: the bounded response keeps it as the group's comment anchor, even
	// though the newest status row is the one the UI renders.
	dbfx.Exec(t, `
		INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, severity, issue_id, title, archived, created_at, details)
		SELECT $1, 'member', $2, 'status_changed', 'info', $3, 'noisy-' || lpad(i::text, 3, '0'), true,
		       $4::timestamptz - i * interval '1 millisecond',
		       CASE WHEN i = 199 THEN '{"comment_id":"comment-1"}'::jsonb ELSE '{}'::jsonb END
		FROM generate_series(0, 199) AS i
	`, workspaceID, testUserID, noisyIssueID, base)
	dbfx.Cleanup(t, `DELETE FROM inbox_item WHERE workspace_id = $1`, workspaceID)
	dbfx.Insert(t, "inbox_item", testutil.Cols{
		"workspace_id":   workspaceID,
		"recipient_type": "member",
		"recipient_id":   testUserID,
		"type":           "issue_assigned",
		"severity":       "info",
		"issue_id":       olderIssueID,
		"title":          "older-group",
		"archived":       true,
		"created_at":     base.Add(-time.Hour),
	})

	var items []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListArchivedInbox),
		inboxRequest(http.MethodGet, "/api/inbox/archived", workspaceID)).
		Want(http.StatusOK).
		JSON(&items)

	var noisyRows int
	var sawNoisyNewest, sawCommentAnchor, sawOlderGroup bool
	for _, item := range items {
		switch {
		case item.IssueID != nil && *item.IssueID == noisyIssueID:
			noisyRows++
			sawNoisyNewest = sawNoisyNewest || item.Title == "noisy-000"
			sawCommentAnchor = sawCommentAnchor || strings.Contains(string(item.Details), `"comment_id":"comment-1"`)
		case item.IssueID != nil && *item.IssueID == olderIssueID:
			sawOlderGroup = true
		}
	}
	if noisyRows != 2 || !sawNoisyNewest || !sawCommentAnchor {
		t.Fatalf("noisy group rows = %d, newest=%v anchor=%v; items=%+v",
			noisyRows, sawNoisyNewest, sawCommentAnchor, items)
	}
	if !sawOlderGroup {
		t.Fatal("raw-row limit let one issue hide another archived issue group")
	}
}

func TestArchiveAllReadInboxUsesNewestIssueRow(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Archive read groups", "archive-read-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	readIssueID := dbfx.Issue(t, "Newest row is read", testutil.Cols{"workspace_id": workspaceID})
	unreadIssueID := dbfx.Issue(t, "Newest row is unread", testutil.Cols{"workspace_id": workspaceID})

	insert := func(issueID, title string, read bool, createdAt testutil.Raw) {
		t.Helper()
		dbfx.Insert(t, "inbox_item", testutil.Cols{
			"workspace_id":   workspaceID,
			"recipient_type": "member",
			"recipient_id":   testUserID,
			"type":           "status_changed",
			"severity":       "info",
			"issue_id":       issueID,
			"title":          title,
			"read":           read,
			"archived":       false,
			"created_at":     createdAt,
		})
	}
	insert(readIssueID, "older unread", false, "now() - interval '2 minutes'")
	insert(readIssueID, "newest read", true, "now() - interval '1 minute'")
	insert(unreadIssueID, "older read", true, "now() - interval '2 minutes'")
	insert(unreadIssueID, "newest unread", false, "now() - interval '1 minute'")

	testutil.Call(t, inboxWorkspaceHandler(testHandler.ArchiveAllReadInbox),
		inboxRequest(http.MethodPost, "/api/inbox/archive-all-read", workspaceID)).
		Want(http.StatusOK)

	if got := dbfx.Count(t,
		"SELECT count(*) FROM inbox_item WHERE issue_id = $1 AND archived = true", readIssueID); got != 2 {
		t.Fatalf("archived rows in read issue = %d, want the whole two-row group", got)
	}
	if got := dbfx.Count(t,
		"SELECT count(*) FROM inbox_item WHERE issue_id = $1 AND archived = true", unreadIssueID); got != 0 {
		t.Fatalf("archived rows in unread issue = %d, want the whole group untouched", got)
	}
}

func TestArchiveCompletedInboxExpandsCustomTerminalStatuses(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Archive custom completed", "archive-custom-completed-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	dbfx.Insert(t, "issue_status", testutil.Cols{
		"workspace_id": workspaceID,
		"key":          "verified_complete",
		"name":         "Verified complete",
		"category":     "done",
		"color":        "#22c55e",
		"is_system":    false,
		"position":     1,
	})
	completedIssueID := dbfx.Issue(t, "Custom completed issue", testutil.Cols{
		"workspace_id": workspaceID,
		"status":       "verified_complete",
	})
	openIssueID := dbfx.Issue(t, "Open issue", testutil.Cols{
		"workspace_id": workspaceID,
		"status":       "todo",
	})
	for _, issueID := range []string{completedIssueID, openIssueID} {
		dbfx.Insert(t, "inbox_item", testutil.Cols{
			"workspace_id":   workspaceID,
			"recipient_type": "member",
			"recipient_id":   testUserID,
			"type":           "status_changed",
			"severity":       "info",
			"issue_id":       issueID,
			"title":          "Status changed",
			"archived":       false,
		})
	}

	testutil.Call(t, inboxWorkspaceHandler(testHandler.ArchiveCompletedInbox),
		inboxRequest(http.MethodPost, "/api/inbox/archive-completed", workspaceID)).
		Want(http.StatusOK)

	if got := dbfx.Count(t,
		"SELECT count(*) FROM inbox_item WHERE issue_id = $1 AND archived = true", completedIssueID); got != 1 {
		t.Fatalf("archived rows for custom completed issue = %d, want 1", got)
	}
	if got := dbfx.Count(t,
		"SELECT count(*) FROM inbox_item WHERE issue_id = $1 AND archived = true", openIssueID); got != 0 {
		t.Fatalf("archived rows for open issue = %d, want 0", got)
	}
}

func TestInboxListBodyPreview(t *testing.T) {
	issue := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	text := func(s string) pgtype.Text { return pgtype.Text{String: s, Valid: true} }
	long := strings.Repeat("a", 5000)
	// Every CJK character is three bytes in UTF-8: a byte-based cut would land
	// mid-character and produce invalid UTF-8.
	longCJK := strings.Repeat("评论内容", 500)

	cases := []struct {
		name      string
		notifType string
		issueID   pgtype.UUID
		body      pgtype.Text
		want      *string
	}{
		{"null body stays null", "new_comment", issue, pgtype.Text{}, nil},
		{"short comment is untouched", "new_comment", issue, text("looks good"), ptr("looks good")},
		{"exactly at the limit is untouched", "new_comment", issue,
			text(strings.Repeat("a", inboxListBodyPreviewLimit)),
			ptr(strings.Repeat("a", inboxListBodyPreviewLimit))},
		{"one past the limit is cut, ellipsis included", "new_comment", issue,
			text(strings.Repeat("a", inboxListBodyPreviewLimit+1)),
			ptr(strings.Repeat("a", inboxListBodyPreviewLimit-1) + "…")},
		{"long comment is cut to the limit", "new_comment", issue, text(long),
			ptr(strings.Repeat("a", inboxListBodyPreviewLimit-1) + "…")},
		// Issue-less notifications render their body in the detail pane from
		// the list cache, so shortening them would lose content.
		{"comment without an issue keeps its full body", "new_comment", pgtype.UUID{}, text(long), ptr(long)},
		// Other types are out of scope even when issue-backed: their body is
		// not merely a preview of something the issue page shows.
		{"other types keep their full body", "task_failed", issue, text(long), ptr(long)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := inboxListBody(tc.notifType, tc.issueID, tc.body)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("body = %q, want nil", *got)
			case tc.want != nil && got == nil:
				t.Fatalf("body = nil, want %d characters", utf8.RuneCountInString(*tc.want))
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("body = %d characters %q…, want %d characters",
					utf8.RuneCountInString(*got), truncateForLog(*got),
					utf8.RuneCountInString(*tc.want))
			}
		})
	}

	t.Run("multi-byte text is cut on a character boundary", func(t *testing.T) {
		got := inboxListBody("new_comment", issue, text(longCJK))
		if got == nil {
			t.Fatal("body = nil")
		}
		if !utf8.ValidString(*got) {
			t.Fatalf("preview is not valid UTF-8: %q", truncateForLog(*got))
		}
		if n := utf8.RuneCountInString(*got); n != inboxListBodyPreviewLimit {
			t.Fatalf("preview = %d characters, want %d", n, inboxListBodyPreviewLimit)
		}
		if !strings.HasSuffix(*got, "…") {
			t.Fatalf("preview does not end with an ellipsis: %q", truncateForLog(*got))
		}
	})
}

// Both inbox lists ship the preview, the stored row keeps the whole comment,
// and a notification that needs its full body still gets it.
func TestInboxListsHideHistoricalCommentsWithoutDeleting(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Inbox body preview", "inbox-preview-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	activeIssue := dbfx.Issue(t, "Active comment issue", testutil.Cols{"workspace_id": workspaceID})
	archivedIssue := dbfx.Issue(t, "Archived comment issue", testutil.Cols{"workspace_id": workspaceID})
	fullComment := strings.Repeat("A long agent reply. ", 300)
	issueLessBody := strings.Repeat("An issue-less notice. ", 300)

	insert := func(cols testutil.Cols) {
		base := testutil.Cols{
			"workspace_id":   workspaceID,
			"recipient_type": "member",
			"recipient_id":   testUserID,
			"severity":       "info",
			"title":          "Notification",
		}
		for k, v := range cols {
			base[k] = v
		}
		dbfx.Insert(t, "inbox_item", base)
	}
	insert(testutil.Cols{"type": "new_comment", "issue_id": activeIssue, "body": fullComment})
	insert(testutil.Cols{"type": "new_comment", "issue_id": archivedIssue, "body": fullComment, "archived": true})
	insert(testutil.Cols{"type": "autopilot_paused", "body": issueLessBody})

	var active, archived []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListInbox), inboxRequest(http.MethodGet, "/api/inbox", workspaceID)).Want(http.StatusOK).JSON(&active)
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListArchivedInbox), inboxRequest(http.MethodGet, "/api/inbox/archived", workspaceID)).Want(http.StatusOK).JSON(&archived)
	if len(active) != 0 || len(archived) != 0 {
		t.Fatal("historical comment or automation notice surfaced")
	}

	// Only the response is shortened; the stored comment is whole.
	if got := dbfx.Count(t,
		`SELECT count(*) FROM inbox_item WHERE workspace_id = $1 AND type = 'new_comment' AND body = $2`,
		workspaceID, fullComment); got != 2 {
		t.Errorf("stored full comments = %d, want 2", got)
	}
}

func truncateForLog(s string) string {
	if r := []rune(s); len(r) > 40 {
		return string(r[:40])
	}
	return s
}

func TestStep3InboxProjectionPreservesHistoryAndCountsVisibleGroups(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Step3 inbox", "step3-inbox-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	issueID := dbfx.Issue(t, "Visible assignment", testutil.Cols{"workspace_id": workspaceID})
	insert := func(kind string, archived, read bool, created testutil.Raw) string {
		return dbfx.Insert(t, "inbox_item", testutil.Cols{
			"workspace_id": workspaceID, "recipient_type": "member", "recipient_id": testUserID,
			"issue_id": issueID, "type": kind, "severity": "info", "title": kind,
			"archived": archived, "read": read, "created_at": created,
		})
	}
	insert("issue_assigned", false, false, "now() - interval '3 minutes'")
	insert("status_changed", false, true, "now() - interval '2 minutes'")
	hiddenID := insert("new_comment", false, false, "now()")
	var items []InboxItemResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListInbox), inboxRequest(http.MethodGet, "/api/inbox", workspaceID)).Want(http.StatusOK).JSON(&items)
	if len(items) != 2 {
		t.Fatalf("visible items = %d, want 2 supported rows", len(items))
	}
	var count struct {
		Count int64 `json:"count"`
	}
	testutil.Call(t, inboxWorkspaceHandler(testHandler.CountUnreadInbox), inboxRequest(http.MethodGet, "/api/inbox/unread-count", workspaceID)).Want(http.StatusOK).JSON(&count)
	if count.Count != 0 {
		t.Fatalf("unread = %d, want 0 (newest visible row read)", count.Count)
	}
	var summary []InboxWorkspaceUnreadResponse
	testutil.Call(t, testHandler.UnreadInboxSummary, inboxRequest(http.MethodGet, "/api/inbox/unread-summary", workspaceID)).Want(http.StatusOK).JSON(&summary)
	for _, row := range summary {
		if row.WorkspaceID == workspaceID && row.Count != 0 {
			t.Fatalf("summary unread = %d, want 0", row.Count)
		}
	}
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ArchiveAllReadInbox), inboxRequest(http.MethodPost, "/api/inbox/archive-all-read", workspaceID)).Want(http.StatusOK)
	if dbfx.Count(t, "SELECT count(*) FROM inbox_item WHERE id=$1 AND NOT archived AND NOT read", hiddenID) != 1 {
		t.Fatal("historical hidden row mutated")
	}
	for _, endpoint := range []http.HandlerFunc{testHandler.MarkInboxRead, testHandler.MarkInboxUnread, testHandler.ArchiveInboxItem, testHandler.UnarchiveInboxItem} {
		req := testutil.WithURLParams(inboxRequest(http.MethodPatch, "/api/inbox/"+hiddenID, workspaceID), "id", hiddenID)
		testutil.Call(t, inboxWorkspaceHandler(endpoint), req).Want(http.StatusNotFound)
	}

	var page archivedInboxPageResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.ListArchivedInboxPage), inboxRequest(http.MethodGet, "/api/inbox/archived/page?group_id="+issueID, workspaceID)).Want(http.StatusOK).JSON(&page)
	if len(page.Items) != 1 || page.Items[0].Type != "status_changed" {
		t.Fatalf("archive blocked by hidden active sibling: %+v", page)
	}
	var facets archivedInboxFacetsResponse
	testutil.Call(t, inboxWorkspaceHandler(testHandler.GetArchivedInboxFacets), inboxRequest(http.MethodGet, "/api/inbox/archived/facets", workspaceID)).Want(http.StatusOK).JSON(&facets)
	if facets.UnreadCount != 0 || facets.Statuses["todo"] != 1 {
		t.Fatalf("archive facets disagree: %+v", facets)
	}
	testutil.Call(t, inboxWorkspaceHandler(testHandler.MarkAllInboxRead), inboxRequest(http.MethodPost, "/api/inbox/read-all", workspaceID)).Want(http.StatusOK)
	if dbfx.Count(t, "SELECT count(*) FROM inbox_item WHERE id=$1 AND NOT archived AND NOT read", hiddenID) != 1 {
		t.Fatal("mark-all changed hidden history")
	}
}

func TestStep3InboxRejectsUnsupportedGeneration(t *testing.T) {
	workspaceID := dbfx.Workspace(t, "Step3 writes", "step3-write-"+uuid.NewString())
	dbfx.Member(t, workspaceID, testUserID, "owner")
	issueID := dbfx.Issue(t, "Notification writes", testutil.Cols{"workspace_id": workspaceID})
	for _, kind := range []string{"new_comment", "review_requested", "task_failed", "children_done", "autopilot_paused", "quick_create_done", "learning_reviewed"} {
		_, err := testHandler.Queries.CreateInboxItem(t.Context(), db.CreateInboxItemParams{
			WorkspaceID: parseUUID(workspaceID), RecipientType: "member", RecipientID: parseUUID(testUserID),
			IssueID: parseUUID(issueID), Type: kind, Severity: "info", Title: kind,
		})
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("create %s = %v, want no row", kind, err)
		}
	}
	if got := dbfx.Count(t, "SELECT count(*) FROM inbox_item WHERE workspace_id=$1", workspaceID); got != 0 {
		t.Fatalf("unsupported notifications persisted: %d", got)
	}
	for _, kind := range []string{"status_changed", "issue_assigned", "unassigned", "assignee_changed"} {
		item, err := testHandler.Queries.CreateInboxItem(t.Context(), db.CreateInboxItemParams{
			WorkspaceID: parseUUID(workspaceID), RecipientType: "member", RecipientID: parseUUID(testUserID),
			IssueID: parseUUID(issueID), Type: kind, Severity: "info", Title: kind,
		})
		if err != nil || item.Type != kind {
			t.Fatalf("supported create %s: item=%+v error=%v", kind, item, err)
		}
	}
	dbfx.Cleanup(t, "DELETE FROM inbox_item WHERE workspace_id=$1", workspaceID)

}

func TestStep3InboxBulkMutationsOnlyTouchSupportedRows(t *testing.T) {
	for _, endpoint := range []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"read", testHandler.MarkAllInboxRead}, {"archive", testHandler.ArchiveAllInbox}, {"completed", testHandler.ArchiveCompletedInbox},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			workspaceID := dbfx.Workspace(t, "Step3 bulk", "step3-bulk-"+uuid.NewString())
			dbfx.Member(t, workspaceID, testUserID, "owner")
			issueID := dbfx.Issue(t, "Done", testutil.Cols{"workspace_id": workspaceID, "status": "done"})
			for _, kind := range []string{"status_changed", "task_failed"} {
				dbfx.Insert(t, "inbox_item", testutil.Cols{"workspace_id": workspaceID, "recipient_type": "member", "recipient_id": testUserID, "issue_id": issueID, "type": kind, "severity": "info", "title": kind})
			}
			testutil.Call(t, inboxWorkspaceHandler(endpoint.handler), inboxRequest(http.MethodPost, "/api/inbox/bulk", workspaceID)).Want(http.StatusOK)
			if got := dbfx.Count(t, "SELECT count(*) FROM inbox_item WHERE workspace_id=$1 AND type='task_failed' AND NOT read AND NOT archived", workspaceID); got != 1 {
				t.Fatal("bulk changed hidden historical item")
			}
			if got := dbfx.Count(t, "SELECT count(*) FROM inbox_item WHERE workspace_id=$1 AND type='status_changed' AND (read OR archived)", workspaceID); got != 1 {
				t.Fatal("bulk did not change visible item")
			}
		})
	}
}
