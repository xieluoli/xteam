-- name: ListIssueImportedUsage :many
SELECT snapshot FROM issue_imported_usage WHERE workspace_id=$1 AND issue_id=$2 ORDER BY source_workspace_id,source_issue_id;

-- name: UpsertIssueImportedUsage :one
INSERT INTO issue_imported_usage(workspace_id,issue_id,source_workspace_id,source_issue_id,captured_at,snapshot)
VALUES($1,$2,$3,$4,$5,$6)
ON CONFLICT (workspace_id,issue_id,source_workspace_id,source_issue_id)
DO UPDATE SET captured_at=EXCLUDED.captured_at,snapshot=EXCLUDED.snapshot,imported_at=now()
WHERE issue_imported_usage.captured_at < EXCLUDED.captured_at
   OR (issue_imported_usage.captured_at = EXCLUDED.captured_at AND issue_imported_usage.snapshot = EXCLUDED.snapshot)
RETURNING snapshot;
