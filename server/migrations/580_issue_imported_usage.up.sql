CREATE TABLE IF NOT EXISTS issue_imported_usage (
    workspace_id UUID NOT NULL,
    issue_id UUID NOT NULL,
    source_workspace_id TEXT NOT NULL,
    source_issue_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    snapshot JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
