package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Subscribing the quick-create requester moved OFF the completion path in
// MUL-5483. It now happens at issue-creation time in the shared
// delegated-subscriber rule, which resolves the human from
// origin_type='quick_create' + the origin task's originator_user_id — the same
// origin waterfall attribution uses. That behavior is covered by
// TestDelegatedSubscribe_QuickCreateKeepsDirectReason in
// delegated_subscriber_test.go, including the assertion that quick create keeps
// the direct 'creator' tier rather than the reduced delegated one.
//
// The failure-path test below stays here: "no issue created ⇒ no subscriber
// row" is a property of the quick-create completion flow itself and holds
// regardless of which layer writes the subscription.

// TestQuickCreateFailure_DoesNotSubscribeRequester confirms the failure path
// (agent finished without producing an issue) does not invent a subscriber
// row — there is nothing to subscribe to.
func TestQuickCreateFailure_DoesNotSubscribeRequester(t *testing.T) {
	ctx := context.Background()
	queries := db.New(testPool)
	bus := events.New()
	taskSvc := service.NewTaskService(queries, testPool, nil, bus)

	var agentID string
	if err := testPool.QueryRow(ctx,
		`SELECT id::text FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}

	task, err := taskSvc.EnqueueQuickCreateTask(ctx,
		parseUUID(testWorkspaceID),
		parseUUID(testUserID),
		parseUUID(agentID),
		pgtype.UUID{},
		"another bug",
		"",
		"",
		pgtype.UUID{},
		pgtype.UUID{},
		nil,
	)
	if err != nil {
		t.Fatalf("EnqueueQuickCreateTask: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, task.ID)
	})

	if _, err := testPool.Exec(ctx,
		`UPDATE agent_task_queue SET status = 'dispatched', dispatched_at = now() WHERE id = $1`,
		task.ID,
	); err != nil {
		t.Fatalf("dispatch task: %v", err)
	}
	if _, err := queries.StartAgentTask(ctx, task.ID); err != nil {
		t.Fatalf("StartAgentTask: %v", err)
	}

	// No issue with origin_type=quick_create + this task id exists. Completion
	// hits the failure branch and writes a failure inbox; no subscriber row.
	if _, err := taskSvc.CompleteTask(ctx, task.ID, []byte(`{"output":"done"}`), "", "", "", false, "", ""); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}

	var leaked int
	if err := testPool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM issue_subscriber s
		JOIN issue i ON i.id = s.issue_id
		WHERE s.user_type = 'member' AND s.user_id = $1
		  AND i.origin_type = 'quick_create' AND i.origin_id = $2
	`, testUserID, task.ID).Scan(&leaked); err != nil {
		t.Fatalf("count leaked subscribers: %v", err)
	}
	if leaked != 0 {
		t.Fatalf("expected no subscriber rows for failed quick-create, got %d", leaked)
	}
}

// The real failure detail is still sanitized before the database suppresses
// the quick-create notification; completion itself must remain committed.
func TestQuickCreateFailure_SurfacesAgentOutput(t *testing.T) {
	ctx := context.Background()
	outcomes := &quickCreateOutcomeDB{DBTX: testPool}
	queries := db.New(outcomes)
	bus := events.New()
	taskSvc := service.NewTaskService(queries, testPool, nil, bus)

	var agentID string
	if err := testPool.QueryRow(ctx,
		`SELECT id::text FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}

	task, err := taskSvc.EnqueueQuickCreateTask(ctx,
		parseUUID(testWorkspaceID),
		parseUUID(testUserID),
		parseUUID(agentID),
		pgtype.UUID{},
		"file that same bug again",
		"",
		"",
		pgtype.UUID{},
		pgtype.UUID{},
		nil,
	)
	if err != nil {
		t.Fatalf("EnqueueQuickCreateTask: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, task.ID)
		deleteInboxForTask(task.ID)
	})

	if _, err := testPool.Exec(ctx,
		`UPDATE agent_task_queue SET status = 'dispatched', dispatched_at = now() WHERE id = $1`,
		task.ID,
	); err != nil {
		t.Fatalf("dispatch task: %v", err)
	}
	if _, err := queries.StartAgentTask(ctx, task.ID); err != nil {
		t.Fatalf("StartAgentTask: %v", err)
	}

	// No issue is created; the agent exits with the CLI duplicate error as its
	// only output (per the quick-create prompt contract).
	const agentErr = "Error: an active issue already exists: JKY-30 (blocked). Pass --allow-duplicate to override."
	result, _ := json.Marshal(map[string]any{"output": agentErr})
	if _, err := taskSvc.CompleteTask(ctx, task.ID, result, "", "", "", false, "", ""); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}

	body, errDetail, _ := requireSuppressedQuickCreateOutcome(t, outcomes, task.ID, "quick_create_failed")

	if !strings.Contains(errDetail, "JKY-30") {
		t.Fatalf("expected failure detail to carry the agent's real error, got %q", errDetail)
	}
	if strings.Contains(errDetail, "agent finished without creating an issue") {
		t.Fatalf("failure detail regressed to the generic message: %q", errDetail)
	}
	if !strings.Contains(body, "JKY-30") {
		t.Fatalf("expected inbox body to carry the agent's real error, got %q", body)
	}
}

// Lookup failure must retain the neutral outcome, never claim a confirmed
// failure from unverified agent output, and must not undo task completion.
func TestQuickCreateLookupFault_SuppressesUnconfirmedInbox(t *testing.T) {
	ctx := context.Background()
	outcomes := &quickCreateOutcomeDB{DBTX: testPool}
	queries := db.New(outcomes)
	bus := events.New()
	taskSvc := service.NewTaskService(queries, testPool, nil, bus)

	var agentID string
	if err := testPool.QueryRow(ctx,
		`SELECT id::text FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}

	task, err := taskSvc.EnqueueQuickCreateTask(ctx,
		parseUUID(testWorkspaceID),
		parseUUID(testUserID),
		parseUUID(agentID),
		pgtype.UUID{},
		"file a bug while the db is flaky",
		"",
		"",
		pgtype.UUID{},
		pgtype.UUID{},
		nil,
	)
	if err != nil {
		t.Fatalf("EnqueueQuickCreateTask: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, task.ID)
		deleteInboxForTask(task.ID)
	})

	if _, err := testPool.Exec(ctx,
		`UPDATE agent_task_queue SET status = 'dispatched', dispatched_at = now() WHERE id = $1`,
		task.ID,
	); err != nil {
		t.Fatalf("dispatch task: %v", err)
	}
	if _, err := queries.StartAgentTask(ctx, task.ID); err != nil {
		t.Fatalf("StartAgentTask: %v", err)
	}

	// Completion runs against a Queries whose origin lookup always faults. The
	// completion transaction is unaffected (runInTx binds queries to the tx),
	// and the captured notification payload still reaches the real database
	// filter. Suppression must not change the neutral wording.
	faulting := service.NewTaskService(
		db.New(failGetIssueByOriginDB{DBTX: outcomes, err: errors.New("simulated transient db fault")}),
		testPool, nil, bus,
	)

	// The agent DID emit a duplicate-style error, but with the lookup faulted we
	// cannot confirm it is the reason — it must not be presented as such.
	result, _ := json.Marshal(map[string]any{
		"output": "Error: an active issue already exists: JKY-30 (blocked).",
	})
	if _, err := faulting.CompleteTask(ctx, task.ID, result, "", "", "", false, "", ""); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}

	body, errDetail, title := requireSuppressedQuickCreateOutcome(t, outcomes, task.ID, "quick_create_unconfirmed")

	if !strings.Contains(body, "Couldn't confirm") {
		t.Fatalf("expected the neutral unconfirmed wording, got body %q", body)
	}
	if title == "Quick create failed" {
		t.Fatalf("unconfirmed outcome must not be titled as a definite failure, got %q", title)
	}
	// The agent's output is not evidence of the outcome here — the lookup never
	// completed, so surfacing it would assert a cause we did not verify.
	if strings.Contains(body, "JKY-30") || strings.Contains(errDetail, "JKY-30") {
		t.Fatalf("unconfirmed outcome must not reuse the agent output as the reason: body=%q detail=%q", body, errDetail)
	}
}

// TestQuickCreateFailure_RedactsAgentOutput locks in that the newly-surfaced
// data source (the agent's final output) is scrubbed before it is stored on the
// notification boundary. Agent output is untrusted text that can contain whatever the run
// echoed, so credentials must be scrubbed even when the inbox type is suppressed.
func TestQuickCreateFailure_RedactsAgentOutput(t *testing.T) {
	ctx := context.Background()
	outcomes := &quickCreateOutcomeDB{DBTX: testPool}
	queries := db.New(outcomes)
	bus := events.New()
	taskSvc := service.NewTaskService(queries, testPool, nil, bus)

	var agentID string
	if err := testPool.QueryRow(ctx,
		`SELECT id::text FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}

	task, err := taskSvc.EnqueueQuickCreateTask(ctx,
		parseUUID(testWorkspaceID),
		parseUUID(testUserID),
		parseUUID(agentID),
		pgtype.UUID{},
		"file a bug and leak a token",
		"",
		"",
		pgtype.UUID{},
		pgtype.UUID{},
		nil,
	)
	if err != nil {
		t.Fatalf("EnqueueQuickCreateTask: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, task.ID)
		deleteInboxForTask(task.ID)
	})

	if _, err := testPool.Exec(ctx,
		`UPDATE agent_task_queue SET status = 'dispatched', dispatched_at = now() WHERE id = $1`,
		task.ID,
	); err != nil {
		t.Fatalf("dispatch task: %v", err)
	}
	if _, err := queries.StartAgentTask(ctx, task.ID); err != nil {
		t.Fatalf("StartAgentTask: %v", err)
	}

	// Fake, non-functional token shaped like a real GitHub PAT.
	const fakeToken = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB"
	result, _ := json.Marshal(map[string]any{
		"output": "Error: create failed while authenticating with " + fakeToken,
	})
	if _, err := taskSvc.CompleteTask(ctx, task.ID, result, "", "", "", false, "", ""); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}

	body, errDetail, _ := requireSuppressedQuickCreateOutcome(t, outcomes, task.ID, "quick_create_failed")

	if strings.Contains(body, fakeToken) || strings.Contains(errDetail, fakeToken) {
		t.Fatal("agent output reached the notification boundary unredacted")
	}
	if !strings.Contains(body, "[REDACTED GITHUB TOKEN]") {
		t.Fatalf("expected the token to be replaced by a redaction placeholder, got %q", body)
	}
}

// Cancellation during reconciliation must not leak into the terminal outcome
// write, even though the current inbox policy suppresses that row.
func TestQuickCreateLookupCancelled_SuppressesUnconfirmedInbox(t *testing.T) {
	setupCtx := context.Background()
	outcomes := &quickCreateOutcomeDB{DBTX: testPool}
	queries := db.New(outcomes)
	bus := events.New()
	taskSvc := service.NewTaskService(queries, testPool, nil, bus)

	var agentID string
	if err := testPool.QueryRow(setupCtx,
		`SELECT id::text FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}

	task, err := taskSvc.EnqueueQuickCreateTask(setupCtx,
		parseUUID(testWorkspaceID),
		parseUUID(testUserID),
		parseUUID(agentID),
		pgtype.UUID{},
		"file a bug while the request is cancelled",
		"",
		"",
		pgtype.UUID{},
		pgtype.UUID{},
		nil,
	)
	if err != nil {
		t.Fatalf("EnqueueQuickCreateTask: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, task.ID)
		deleteInboxForTask(task.ID)
	})

	if _, err := testPool.Exec(setupCtx,
		`UPDATE agent_task_queue SET status = 'dispatched', dispatched_at = now() WHERE id = $1`,
		task.ID,
	); err != nil {
		t.Fatalf("dispatch task: %v", err)
	}
	if _, err := queries.StartAgentTask(setupCtx, task.ID); err != nil {
		t.Fatalf("StartAgentTask: %v", err)
	}

	// The completion transaction runs on a healthy context; the context dies at
	// the moment of the origin lookup, exactly as a cancelled request would.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	faulting := service.NewTaskService(
		db.New(cancelOnGetIssueByOriginDB{DBTX: outcomes, cancel: cancel}),
		testPool, nil, bus,
	)

	result, _ := json.Marshal(map[string]any{"output": "Error: something went wrong"})
	if _, err := faulting.CompleteTask(ctx, task.ID, result, "", "", "", false, "", ""); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}
	if ctx.Err() == nil {
		t.Fatal("test setup is wrong: the context should have been cancelled during the lookup")
	}

	body, _, _ := requireSuppressedQuickCreateOutcome(t, outcomes, task.ID, "quick_create_unconfirmed")
	if !strings.Contains(body, "Couldn't confirm") {
		t.Fatalf("expected the neutral unconfirmed wording, got %q", body)
	}
}

// quickCreateOutcomeDB records the actual serialized outcome before forwarding
// it to Postgres, where the inbox allowlist suppresses quick-create rows. This
// keeps the neutral-wording, redaction and detached-context boundary covered.
type quickCreateOutcomeDB struct {
	db.DBTX
	outcomes []struct {
		kind, body, title string
		details           []byte
		contextErr        error
	}
}

func (d *quickCreateOutcomeDB) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "name: CreateInboxItem") {
		d.outcomes = append(d.outcomes, struct {
			kind, body, title string
			details           []byte
			contextErr        error
		}{args[3].(string), args[7].(pgtype.Text).String, args[6].(string), args[10].([]byte), ctx.Err()})
	}
	return d.DBTX.QueryRow(ctx, query, args...)
}

func requireSuppressedQuickCreateOutcome(t *testing.T, outcomes *quickCreateOutcomeDB, taskID pgtype.UUID, kind string) (string, string, string) {
	t.Helper()
	if len(outcomes.outcomes) != 1 || outcomes.outcomes[0].kind != kind {
		t.Fatalf("outcomes = %+v, want one %s attempt", outcomes.outcomes, kind)
	}
	outcome := outcomes.outcomes[0]
	if outcome.contextErr != nil {
		t.Fatalf("terminal outcome inherited cancelled request: %v", outcome.contextErr)
	}
	var count int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM inbox_item WHERE details->>'task_id' = $1::text`, taskID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("quick-create inbox rows = %d, error = %v", count, err)
	}
	var status string
	if err := testPool.QueryRow(context.Background(), `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status); err != nil || status != "completed" {
		t.Fatalf("task status = %q, error = %v", status, err)
	}
	var details struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(outcome.details, &details); err != nil {
		t.Fatal(err)
	}
	return outcome.body, details.Error, outcome.title
}

func deleteInboxForTask(taskID pgtype.UUID) {
	testPool.Exec(context.Background(),
		`DELETE FROM inbox_item WHERE details->>'task_id' = $1::text`, taskID)
}

// failGetIssueByOriginDB delegates every statement to the real pool except the
// quick-create completion lookup, which it fails with a non-ErrNoRows error to
// simulate a transient DB fault on exactly that query. Everything else —
// including the captured inbox write — still hits the real DB.
type failGetIssueByOriginDB struct {
	db.DBTX
	err error
}

func (f failGetIssueByOriginDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	// sqlc keeps the `-- name: <Query>` header in the generated SQL constant,
	// so this matches that one query and nothing else.
	if strings.Contains(sql, "name: GetIssueByOrigin") {
		return errRow{err: f.err}
	}
	return f.DBTX.QueryRow(ctx, sql, args...)
}

// cancelOnGetIssueByOriginDB cancels the caller's context at the moment of the
// origin lookup and fails it with context.Canceled — the shape a cancelled or
// timed-out request actually produces, where every later use of that same
// context is doomed too.
type cancelOnGetIssueByOriginDB struct {
	db.DBTX
	cancel context.CancelFunc
}

func (f cancelOnGetIssueByOriginDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	if strings.Contains(sql, "name: GetIssueByOrigin") {
		f.cancel()
		return errRow{err: context.Canceled}
	}
	return f.DBTX.QueryRow(ctx, sql, args...)
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }
