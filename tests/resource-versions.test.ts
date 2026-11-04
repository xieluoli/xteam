import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/store.js';
import { resources, ResourceError, resourceKinds } from '../server/resources.js';

test('Resource versions advance despite a stopped/backwards clock and stale writers on separate SQLite connections fail', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-versions-'));
    const firstDb = openDatabase(join(directory, 'test.db'));
    const secondDb = openDatabase(join(directory, 'test.db'));
    const first = resources(firstDb);
    const second = resources(secondDb);
    try {
        const project = first.save('projects', { name: 'Parent' });
        for (const kind of resourceKinds) {
            const entry = first.save(kind, kind === 'todos' ? { project_id: project.id, title: kind } : kind === 'links' ? { project_id: project.id, title: kind, url: 'https://example.com' } : { name: kind });
            const future = '2090-01-01T00:00:00.000Z';
            firstDb.prepare(`UPDATE ${kind} SET updated_at=? WHERE id=?`).run(future, entry.id);
            const updated = first.update(kind, entry.id, { expected_updated_at: future, ...(kind === 'todos' || kind === 'links' ? { title: 'First writer' } : { name: 'First writer' }) });
            assert.equal(updated.updated_at, '2090-01-01T00:00:00.001Z');
            assert.throws(() => second.update(kind, entry.id, { expected_updated_at: future, description: 'Stale' }), (error: unknown) => error instanceof ResourceError && error.status === 409);
            assert.throws(() => second.remove(kind, entry.id, future), (error: unknown) => error instanceof ResourceError && error.status === 409);
            assert.deepEqual(second.get(kind, entry.id), updated);
            second.remove(kind, entry.id, updated.updated_at);
            assert.throws(() => first.update(kind, entry.id, { expected_updated_at: updated.updated_at }), (error: unknown) => error instanceof ResourceError && error.status === 404);
        }
    } finally { secondDb.close(); firstDb.close(); rmSync(directory, { recursive: true, force: true }); }
});
