-- name: GetProjectContext :one
SELECT document, revision FROM project_context WHERE project_id = $1;

-- name: CreateProjectContext :execrows
INSERT INTO project_context (project_id, document) VALUES ($1, $2)
ON CONFLICT (project_id) DO NOTHING;

-- name: UpdateProjectContext :execrows
UPDATE project_context SET document = $2, revision = revision + 1
WHERE project_id = $1 AND revision = $3;

-- name: DeleteProjectContext :exec
DELETE FROM project_context WHERE project_id = $1;
