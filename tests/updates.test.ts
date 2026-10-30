import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase, provisionUser } from '../server/store.js';

test('upgrade routes keep login/CSRF, restrict operators and forward only a pinned release to the host socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xt-update-'));
    const socket = join(directory, 'updater.sock');
    const calls: { method?: string; path?: string; body: string }[] = [];
    const daemon = createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        calls.push({ method: request.method, path: request.url, body });
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ phase: request.method === 'POST' ? 'checking' : 'idle', message: '等待检查', updatedAt: new Date().toISOString() }));
    });
    await new Promise<void>(resolve => daemon.listen(socket, resolve));
    const dbPath = join(directory, 'test.db');
    const database = openDatabase(dbPath);
    for (const email of ['operator@example.com', 'member@example.com']) provisionUser(database, email, 'test-update-password');
    database.close();
    const origin = 'http://localhost';
    const app = createApp({ database: dbPath, origin, secure: false, upgrade: { socket, admins: ['operator@example.com'] } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    async function login(email: string) {
        const response = await fetch(url + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-update-password' }) });
        assert.equal(response.status, 200);
        return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: (await response.json()).csrf };
    }
    try {
        assert.equal((await fetch(url + '/api/updates')).status, 401);
        const member = await login('member@example.com');
        const memberHeaders = { Cookie: member.cookie, Origin: origin, 'X-CSRF-Token': member.csrf, 'Content-Type': 'application/json' };
        const view = await (await fetch(url + '/api/updates', { headers: memberHeaders })).json();
        assert.equal(view.canUpgrade, false);
        assert.equal((await fetch(url + '/api/updates/check', { method: 'POST', headers: memberHeaders, body: '{}' })).status, 403);
        const operator = await login('operator@example.com');
        const headers = { Cookie: operator.cookie, Origin: origin, 'X-CSRF-Token': operator.csrf, 'Content-Type': 'application/json' };
        assert.equal((await (await fetch(url + '/api/updates', { headers })).json()).canUpgrade, true);
        assert.equal((await fetch(url + '/api/updates/check', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': '' }, body: '{}' })).status, 403);
        assert.equal((await fetch(url + '/api/updates/check', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
        assert.equal((await fetch(url + '/api/updates/check', { method: 'POST', headers, body: '{}' })).status, 202);
        const sha = 'a'.repeat(40);
        assert.equal((await fetch(url + '/api/updates/upgrade', { method: 'POST', headers, body: JSON.stringify({ releaseId: 12, sha, command: 'bad' }) })).status, 400);
        assert.equal((await fetch(url + '/api/updates/upgrade', { method: 'POST', headers, body: JSON.stringify({ releaseId: 12, sha: 'main' }) })).status, 400);
        assert.equal((await fetch(url + '/api/updates/upgrade', { method: 'POST', headers, body: JSON.stringify({ releaseId: 12, sha }) })).status, 202);
        const forwarded = calls.find(call => call.path === '/upgrade');
        assert.deepEqual(JSON.parse(forwarded!.body), { releaseId: 12, sha });
        assert.equal(calls.filter(call => call.path === '/check').length, 1);
        await new Promise<void>(resolve => daemon.close(() => resolve()));
        assert.equal((await fetch(url + '/api/updates', { headers })).status, 503);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        if (daemon.listening) await new Promise<void>(resolve => daemon.close(() => resolve()));
        app.locals.database.close();
        await rm(directory, { recursive: true, force: true });
    }
});
