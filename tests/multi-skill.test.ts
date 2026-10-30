import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, provisionUser } from '../server/store.js';
import { createApp } from '../server/app.js';
import { multiSkillNetwork, snapshot } from './multi-skill-network.js';

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'xt-multi-'));
    const path = join(directory, 'test.db'), network = multiSkillNetwork();
    const database = openDatabase(path); provisionUser(database, 'multi@example.com', 'multi-test-password'); database.close();
    const app = createApp({ database: path, origin: 'http://localhost', skillFetch: network.fetcher });
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'multi@example.com', password: 'multi-test-password' }) });
    const session = await login.json(), cookie = login.headers.get('set-cookie')!.split(';')[0];
    async function request(path: string, body?: unknown, authenticated = true, csrf = true): Promise<any> {
        const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie, ...(csrf ? { 'X-CSRF-Token': session.csrf } : {}) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
    }
    return { app, base, network, request, async close() { await new Promise<void>(resolve => server.close(() => resolve())); app.locals.database.close(); await rm(directory, { recursive: true, force: true }); } };
}
const url = 'https://github.com/example/pmspec';
const item = (name: string, on_conflict = 'fail') => ({ path: 'skills/pmspec-' + name, on_conflict });
test('discovery is read-only; selecting two imports only those pinned bundles with separate files and source refresh', async () => {
    const context = await fixture();
    try {
        assert.equal((await context.request('/skills/discover', { url }, false)).status, 401);
        assert.equal((await context.request('/skills/discover', { url }, true, false)).status, 403);
        const found = await context.request('/skills/discover', { url });
        assert.equal(found.status, 200); assert.equal(found.data.candidates.length, 5); assert.equal(found.data.sha, snapshot);
        assert.equal((await context.request('/skills')).data.length, 0);
        context.network.state.branchMoved = true;
        const result = await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply'), item('review')] });
        assert.equal(result.status, 200); assert.deepEqual(result.data.results.map((value: any) => value.status), ['created', 'created']);
        assert.equal(result.data.sha, snapshot);
        const list = (await context.request('/skills')).data; assert.equal(list.length, 2);
        const skill = (await context.request('/skills/' + result.data.results[0].skill.id)).data;
        assert.equal(skill.files.length, 1); assert.match(skill.files[0].content, /apply-note/);
        assert.equal(skill.source_url, url + '/tree/main/skills/pmspec-apply');
        assert.equal((await context.request('/skills/' + skill.id + '/refresh', {})).status, 200);
        assert.equal((await context.request('/skills')).data.length, 2);
        assert.equal((await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('init'), item('init')] })).status, 400);
        assert.equal((await context.request('/skills/import-batch', { url, sha: snapshot, items: [] })).status, 400);
        context.network.state.rootSkill = true;
        const rootCandidate = (await context.request('/skills/discover', { url })).data.candidates.find((candidate: any) => candidate.path === '');
        assert.equal(rootCandidate.name, 'pmspec');
        const root = await context.request('/skills/import-batch', { url, sha: snapshot, items: [{ path: '' }] });
        assert.equal(root.data.results[0].skill.name, rootCandidate.name);
        assert.equal((await context.request('/skills/' + root.data.results[0].skill.id)).data.files.length, 0);
        assert.equal((await context.request('/skills/discover', { url })).data.candidates.find((candidate: any) => candidate.path === '').existing_skill.id, root.data.results[0].skill.id);
    } finally { await context.close(); }
});
test('batch imports keep successful items through conflicts and failures; retries and explicit strategies preserve old data', async () => {
    const context = await fixture();
    try {
        const first = await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply')] });
        const identifier = first.data.results[0].skill.id;
        context.network.state.failedBlob = 'explore-note';
        const mixed = await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply'), item('explore'), item('review')] });
        assert.deepEqual(mixed.data.results.map((value: any) => value.status), ['conflict', 'failed', 'created']);
        assert.equal((await context.request('/skills')).data.length, 2);
        context.network.state.failedBlob = '';
        const retry = await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply', 'skip'), item('explore')] });
        assert.deepEqual(retry.data.results.map((value: any) => value.status), ['skipped', 'created']);
        const overwrite = await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply', 'overwrite'), item('review', 'rename')] });
        assert.equal(overwrite.data.results[0].skill.id, identifier);
        assert.equal(overwrite.data.results[1].skill.name, 'pmspec-review-2');
        assert.equal((await context.request('/skills')).data.length, 4);
    } finally { await context.close(); }
});
test('real MCP SDK discovers a suite and imports all five through the same web resource rules', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const context = await fixture(), client = new Client({ name: 'multi-skill-test', version: '1' });
    try {
        const token = (await context.request('/tokens', { name: 'Suite test' })).data.token;
        await client.connect(new StreamableHTTPClientTransport(new URL(context.base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
        async function call(name: string, args: Record<string, unknown>) {
            const response = await client.callTool({ name, arguments: args });
            assert.notEqual(response.isError, true, JSON.stringify(response));
            return JSON.parse((response.content as { text: string }[])[0].text);
        }
        const found = await call('discover_skills', { url });
        assert.equal(found.candidates.length, 5);
        const batch = await call('import_skills', { url, sha: found.sha, items: found.candidates.map((candidate: any) => ({ path: candidate.path })) });
        assert.equal(batch.results.filter((result: any) => result.status === 'created').length, 5);
        const skill = await call('get_skill', { id: batch.results[2].skill.id });
        assert.equal(skill.name, 'pmspec-init'); assert.match(skill.files[0].content, /init-note/);
        assert.equal((await context.request('/skills')).data.length, 5);
        const repeated = await call('import_skill', { url: skill.source_url, on_conflict: 'skip' });
        assert.equal(repeated.status, 'skipped');
    } finally { await client.close(); await context.close(); }
});
test('batch boundaries reject malformed bodies and stop downloads after the text budget is exhausted', async () => {
    const context = await fixture();
    try {
        for (const path of ['/skills/discover', '/skills/import-batch']) {
            assert.equal((await context.request(path, null)).status, 400);
            assert.equal((await context.request(path, {})).status, 400);
        }
        const before = context.network.calls.length;
        assert.equal((await context.request('/skills/import', { url, on_conflict: 'invalid' })).status, 400);
        assert.equal(context.network.calls.length, before);
        assert.equal((await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply')] }, false)).status, 401);
        assert.equal((await context.request('/skills/import-batch', { url, sha: snapshot, items: [item('apply')] }, true, false)).status, 403);
        context.network.state.largeBundles = true; context.network.state.count = 6;
        const result = await context.request('/skills/import-batch', { url, sha: snapshot, items: ['apply', 'explore', 'init', 'propose', 'review', 'extra-5'].map(name => item(name)) });
        assert.deepEqual(result.data.results.map((value: any) => value.status), ['created', 'created', 'created', 'created', 'failed', 'failed']);
        assert.match(result.data.results[4].error, /32 MiB/);
        assert.equal(context.network.calls.some(value => value.includes('/git/blobs/extra-5')), false);
        assert.equal((await context.request('/skills')).data.length, 4);
    } finally { await context.close(); }
});
