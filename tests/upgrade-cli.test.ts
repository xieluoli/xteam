import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runUpgradeCli } from '../scripts/upgrade.js';

test('CLI upgrades through authenticated HTTP without SSH, pins the checked release and reports rollback as failure', async () => {
    const requests: { path?: string; body: any }[] = [];
    const sha = 'b'.repeat(40);
    let phase = 'idle', rollback = false;
    const server = createServer(async (request, response) => {
        let text = '';
        for await (const chunk of request) text += chunk;
        const body = text ? JSON.parse(text) : {};
        requests.push({ path: request.url, body });
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/api/login') { assert.equal(body.password, 'temporary-test-password'); response.setHeader('Set-Cookie', 'xteam_session=test-session; HttpOnly'); response.end(JSON.stringify({ csrf: 'test-csrf' })); return; }
        assert.equal(request.headers.cookie, 'xteam_session=test-session');
        if (request.method === 'POST') { assert.equal(request.headers['x-csrf-token'], 'test-csrf'); assert.match(request.headers.origin!, /^http:\/\/127\.0\.0\.1:/); }
        const state = { phase, requestId: 'operation', available: true, release: { id: 42, sha, tag: 'v2.0.0' }, message: phase };
        if (request.url === '/api/updates/check') { phase = 'ready'; response.end(JSON.stringify({ ...state, phase: 'checking' })); }
        else if (request.url === '/api/updates/upgrade') { assert.deepEqual(body, { releaseId: 42, sha }); phase = rollback ? 'rolled_back' : 'succeeded'; response.end(JSON.stringify({ ...state, phase: 'upgrading' })); }
        else if (request.url === '/api/logout') response.end('{}');
        else response.end(JSON.stringify({ enabled: true, canUpgrade: true, currentVersion: 'a'.repeat(40), state }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const output: string[] = [];
    try {
        const prompt = async (_question: string, secret: boolean) => secret ? 'temporary-test-password' : 'upgrade';
        assert.equal(await runUpgradeCli(['upgrade', '--url', url, '--email', 'operator@example.com'], prompt, value => output.push(value)), 0);
        assert.equal(requests.filter(request => request.path === '/api/updates/upgrade').length, 1);
        assert.equal(requests.at(-1)!.path, '/api/logout');
        rollback = true;
        assert.equal(await runUpgradeCli(['upgrade', '--url', url, '--email', 'operator@example.com', '--yes'], prompt, value => output.push(value)), 2);
        assert(!output.join('').includes('temporary-test-password'));
        const count = requests.length;
        await assert.rejects(runUpgradeCli(['check', '--url', 'http://example.com', '--email', 'operator@example.com'], prompt), /HTTPS/);
        assert.equal(requests.length, count);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
