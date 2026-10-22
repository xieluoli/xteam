CREATE TABLE mcp_key (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    scopes text[] NOT NULL,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE mcp_issue_request (
    key_id uuid NOT NULL,
    request_id text NOT NULL,
    fingerprint text NOT NULL,
    issue_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
