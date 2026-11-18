import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/store.js';
import { resources } from '../server/resources.js';
import { knowledge } from '../server/knowledge.js';
import { todoManifest, archiveTodos, restoreTodoBatch } from '../server/todo-archive.js';
import { importLegacyProjects } from '../server/knowledge-import.js';

test('Todo archival keeps original IDs and experience text; stale plans stop atomically and restoration preserves new Wiki content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-todo-archive-'));
    const db = openDatabase(join(directory, 'data.db'));
    try {
        const service = resources(db), k = knowledge(db);
        const project = service.save('projects', { name: '原项目' });
        service.save('links', { project_id: project.id, title: '仓库', url: 'https://example.com/source' });
        const imported = importLegacyProjects(db, 'member');
        assert.deepEqual(importLegacyProjects(db, 'member'), imported);
        assert.equal(k.listSpaces().length, 1);
        assert.equal(k.listPages(String((imported[0] as { space_id: string }).space_id)).length, 2);
        const original = service.save('todos', { project_id: project.id, title: '旧任务', description: '原说明、经验和确认历史', completed: false });
        const stale = todoManifest(db);
        service.update('todos', original.id, { description: '其他设备的新记录' });
        assert.throws(() => archiveTodos(db, stale.sha256), /已变化/);
        assert.equal(service.list('todos').length, 1);
        const manifest = todoManifest(db), archived = archiveTodos(db, manifest.sha256);
        assert.equal(archived.archived, 1);
        assert.equal(service.list('todos').length, 0);
        assert.equal(service.list('links').length, 1);
        const space = k.createSpace({ name: '新的知识' }, 'member');
        const page = k.createPage({ space_id: space.id, title: '保留新知识' }, 'member');
        restoreTodoBatch(db, archived.batch_id!);
        assert.equal(service.get('todos', original.id).description, '其他设备的新记录');
        assert.equal(service.get('todos', original.id).completed, false);
        assert.equal(k.page(page.id).title, '保留新知识');
        assert.throws(() => restoreTodoBatch(db, archived.batch_id!), /ID 已存在/);
        const previous = process.env.XTEAM_TODOS_RETIRED;
        try {
            process.env.XTEAM_TODOS_RETIRED = '1';
            assert.throws(() => service.save('todos', { project_id: project.id, title: '不能再生' }), /已归档/);
            assert.throws(() => service.update('todos', original.id, { description: '不能覆盖' }), /已归档/);
        } finally { if (previous === undefined) delete process.env.XTEAM_TODOS_RETIRED; else process.env.XTEAM_TODOS_RETIRED = previous; }
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
