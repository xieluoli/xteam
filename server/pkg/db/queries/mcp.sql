-- name: CreateMCPKey :one
INSERT INTO mcp_key (user_id,workspace_id,name,token_hash,token_prefix,scopes,expires_at)
VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *;

-- name: ListMCPKeys :many
SELECT * FROM mcp_key WHERE user_id=$1 AND NOT revoked ORDER BY created_at DESC;

-- name: GetMCPKeyByHash :one
SELECT * FROM mcp_key WHERE token_hash=$1 AND NOT revoked AND expires_at>now();

-- name: RevokeMCPKey :execrows
UPDATE mcp_key SET revoked=true WHERE id=$1 AND user_id=$2 AND NOT revoked;

-- name: TouchMCPKey :exec
UPDATE mcp_key SET last_used_at=now() WHERE id=$1;

-- name: GetMCPIssueRequest :one
SELECT * FROM mcp_issue_request WHERE key_id=$1 AND request_id=$2;

-- name: SaveMCPIssueRequest :exec
INSERT INTO mcp_issue_request(key_id,request_id,fingerprint,issue_id) VALUES($1,$2,$3,$4);
