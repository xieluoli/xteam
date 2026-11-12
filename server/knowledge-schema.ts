import type Database from 'better-sqlite3';

export function migrateKnowledge(db: Database.Database) {
    db.transaction(() => db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_project_imports (project_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, overview_page_id TEXT NOT NULL, history_page_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_pages (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS knowledge_pages_space ON knowledge_pages(space_id,archived);
        CREATE TABLE IF NOT EXISTS knowledge_revisions (page_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(page_id,version));
        CREATE TABLE IF NOT EXISTS knowledge_requests (member TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY(member,request_id));
        CREATE TABLE IF NOT EXISTS knowledge_attachments (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(page_id,name,sha256));
        CREATE TABLE IF NOT EXISTS knowledge_skill_sources (skill_id TEXT NOT NULL, page_id TEXT NOT NULL, page_version INTEGER NOT NULL, PRIMARY KEY(skill_id));
        CREATE TABLE IF NOT EXISTS agent_skill_bindings (agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(agent_id,skill_id));
        CREATE TABLE IF NOT EXISTS knowledge_workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, steps TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_todo_archives (batch_id TEXT NOT NULL, todo_id TEXT NOT NULL, snapshot TEXT NOT NULL, archived_at TEXT NOT NULL, PRIMARY KEY(batch_id,todo_id));
        INSERT OR IGNORE INTO knowledge_migrations VALUES (1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `))();
}
