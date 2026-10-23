package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type importedUsageCoverage struct {
	TerminalTaskCount   int64 `json:"terminal_task_count"`
	MeteredTaskCount    int64 `json:"metered_task_count"`
	UnreportedTaskCount int64 `json:"unreported_task_count"`
}

type importedUsageSnapshot struct {
	SourceWorkspaceID     string                 `json:"source_workspace_id"`
	SourceIssueID         string                 `json:"source_issue_id"`
	SourceIssueIdentifier string                 `json:"source_issue_identifier"`
	SourceName            string                 `json:"source_name"`
	CapturedAt            string                 `json:"captured_at"`
	InputTokens           int64                  `json:"input_tokens"`
	OutputTokens          int64                  `json:"output_tokens"`
	CacheReadTokens       int64                  `json:"cache_read_tokens"`
	CacheWriteTokens      int64                  `json:"cache_write_tokens"`
	TaskCount             int64                  `json:"task_count"`
	Coverage              *importedUsageCoverage `json:"coverage"`
}

func (h *Handler) ListIssueImportedUsage(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rows, err := h.Queries.ListIssueImportedUsage(r.Context(), db.ListIssueImportedUsageParams{WorkspaceID: issue.WorkspaceID, IssueID: issue.ID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read historical usage")
		return
	}
	snapshots := make([]json.RawMessage, 0, len(rows))
	for _, row := range rows {
		snapshots = append(snapshots, json.RawMessage(row))
	}
	writeJSON(w, http.StatusOK, snapshots)
}

func (h *Handler) ImportIssueUsage(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var snapshot importedUsageSnapshot
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&snapshot) != nil || decoder.Decode(new(any)) != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid historical usage snapshot")
		return
	}
	for _, text := range []string{snapshot.SourceWorkspaceID, snapshot.SourceIssueID, snapshot.SourceIssueIdentifier, snapshot.SourceName} {
		if strings.TrimSpace(text) == "" || len(text) > 200 {
			writeError(w, http.StatusBadRequest, "source identity is required (max 200 bytes per field)")
			return
		}
	}
	captured, err := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "captured_at must be RFC3339")
		return
	}
	counts := []int64{snapshot.InputTokens, snapshot.OutputTokens, snapshot.CacheReadTokens, snapshot.CacheWriteTokens, snapshot.TaskCount}
	if coverage := snapshot.Coverage; coverage != nil {
		counts = append(counts, coverage.TerminalTaskCount, coverage.MeteredTaskCount, coverage.UnreportedTaskCount)
		if coverage.TerminalTaskCount != coverage.MeteredTaskCount+coverage.UnreportedTaskCount {
			writeError(w, http.StatusBadRequest, "usage coverage counts are inconsistent")
			return
		}
	}
	for _, count := range counts {
		if count < 0 || count > 9007199254740991 {
			writeError(w, http.StatusBadRequest, "usage counts must be nonnegative safe integers")
			return
		}
	}
	snapshot.CapturedAt = captured.UTC().Format(time.RFC3339Nano)
	encoded, _ := json.Marshal(snapshot)
	tx, err := h.beginWakeupWrite(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import historical usage")
		return
	}
	defer tx.Rollback(r.Context())
	queries := h.Queries.WithTx(tx)
	// Serialize against issue deletion so a concurrent import cannot leave an orphan.
	if _, err = queries.LockIssueForDelete(r.Context(), db.LockIssueForDeleteParams{ID: issue.ID, WorkspaceID: issue.WorkspaceID}); err != nil {
		writeError(w, http.StatusNotFound, "issue not found")
		return
	}
	stored, err := queries.UpsertIssueImportedUsage(r.Context(), db.UpsertIssueImportedUsageParams{WorkspaceID: issue.WorkspaceID, IssueID: issue.ID, SourceWorkspaceID: snapshot.SourceWorkspaceID, SourceIssueID: snapshot.SourceIssueID, CapturedAt: pgtype.Timestamptz{Time: captured, Valid: true}, Snapshot: encoded})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "snapshot is stale or conflicts with the same capture time")
		return
	}
	if err != nil || tx.Commit(r.Context()) != nil {
		writeError(w, http.StatusInternalServerError, "failed to import historical usage")
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(stored))
}
