CREATE TABLE project_context (
    project_id uuid NOT NULL,
    document jsonb NOT NULL DEFAULT '{}'::jsonb,
    revision bigint NOT NULL DEFAULT 1
);
