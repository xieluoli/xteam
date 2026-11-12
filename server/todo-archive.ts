import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { ResourceError } from './resources.js';

export function todoManifest(db: Database.Database) {
    const rows = db.prepare('SELECT id,project_id,title,description,completed,updated_at FROM todos ORDER BY id').all() as Record<string, string | number>[];
    return { schema_version: 1, recorded_at: new Date().toISOString(), count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), rows };
}
export function archiveTodos(db: Database.Database, expectedSha: string) {
    return db.transaction(() => {
        const manifest = todoManifest(db);
        if (manifest.sha256 !== expectedSha) throw new ResourceError('任务清单已变化，停止清理；请重新导出并核对', 409);
        if (!manifest.count) return { batch_id: null, archived: 0 };
        const batch = randomUUID(), now = new Date().toISOString();
        const save = db.prepare('INSERT INTO legacy_todo_archives VALUES (?,?,?,?)');
        for (const row of manifest.rows) save.run(batch, row.id, JSON.stringify(row), now);
        db.prepare('DELETE FROM todos').run();
        return { batch_id: batch, archived: manifest.count };
    }).immediate();
}
export function restoreTodoBatch(db: Database.Database, batch: string) {
    return db.transaction(() => {
        const archived = db.prepare('SELECT snapshot FROM legacy_todo_archives WHERE batch_id=? ORDER BY todo_id').all(batch) as { snapshot: string }[];
        if (!archived.length) throw new ResourceError('归档批次不存在', 404);
        const rows = archived.map(a => JSON.parse(a.snapshot));
        for (const row of rows) {
            if (db.prepare('SELECT id FROM todos WHERE id=?').get(row.id)) throw new ResourceError('原任务 ID 已存在，恢复停止，未覆盖任何任务', 409);
            if (!db.prepare('SELECT id FROM projects WHERE id=?').get(row.project_id)) throw new ResourceError('原项目已不存在，恢复停止', 409);
        }
        for (const row of rows) db.prepare('INSERT INTO todos (id,project_id,title,description,completed,updated_at) VALUES (?,?,?,?,?,?)').run(row.id, row.project_id, row.title, row.description, row.completed, row.updated_at);
        return { restored: rows.length, batch_id: batch };
    }).immediate();
}
