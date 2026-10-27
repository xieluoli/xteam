import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, provisionUser, disableUser } from '../server/store.js';
import { resources, resourceKinds } from '../server/resources.js';
import { createApp } from '../server/app.js';
test('resource mutations validate persisted fields and deletion actually removes every resource kind', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-resources-'));
    const database = openDatabase(join(directory, 'test.db'));
    const service = resources(database);
    try {
        const project = service.save('projects', { name: 'Context' });
        for (const kind of resourceKinds.filter(kind => kind !== 'projects')) {
            const item = service.save(kind, kind === 'links' ? { project_id: project.id, title: 'Reference', url: 'https://example.com' } : kind === 'todos' ? { project_id: project.id, title: 'Action' } : { name: 'Instructions', content: '<script>not executed</script>' });
            const updated = service.update(kind, item.id, kind === 'links' || kind === 'todos' ? { title: 'Updated' } : { name: 'Updated' });
            assert.equal(updated.title ?? updated.name, 'Updated');
            if (kind === 'links')
                assert.throws(() => service.update(kind, item.id, { url: 'file:///etc/passwd' }));
            if (kind === 'todos')
                assert.throws(() => service.update(kind, item.id, { completed: 'false' }));
            service.remove(kind, item.id);
            assert.throws(() => service.get(kind, item.id), /不存在/);
        }
        assert.throws(() => service.save('projects', { name: '  ' }));
    }
    finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
test('logout, rate limit and disable then re-enable never restore old access tokens', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-security-'));
    const path = join(directory, 'test.db');
    const database = openDatabase(path);
    provisionUser(database, 'member@example.com', 'member-password');
    const app = createApp({ database: path, origin: 'http://localhost', secure: false });
    let server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = () => `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    const post = (path: string, body: unknown, extra = {}) => fetch(base() + path, { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    try {
        const login = await post('/api/login', { email: 'member@example.com', password: 'member-password' });
        const session = await login.json();
        const cookie = login.headers.get('set-cookie')!.split(';')[0];
        const headers = { Cookie: cookie, 'X-CSRF-Token': session.csrf };
        const token = await (await post('/api/tokens', { name: 'Keep private' }, headers)).json();
        assert.equal((await post('/api/logout', {}, headers)).status, 200);
        assert.equal((await fetch(base() + '/api/me', { headers })).status, 401);
        disableUser(database, 'member@example.com');
        provisionUser(database, 'member@example.com', 'member-password');
        assert.equal((await post('/mcp', {}, { Authorization: 'Bearer ' + token.token })).status, 401);
        for (let attempt = 0; attempt < 15; attempt++)
            assert.equal((await post('/api/login', { email: 'member@example.com', password: 'wrong' })).status, 401);
        assert.equal((await post('/api/login', { email: 'member@example.com', password: 'wrong' })).status, 429);
        await new Promise<void>(resolve => server.close(() => resolve()));
        app.locals.database.close();
        const restarted = createApp({ database: path, origin: 'http://localhost', secure: false });
        server = restarted.listen(0, '127.0.0.1');
        await new Promise<void>(resolve => server.once('listening', resolve));
        const fresh = await post('/api/login', { email: 'member@example.com', password: 'member-password' });
        assert.equal(fresh.status, 200);
        restarted.locals.database.close();
    }
    finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
