import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, provisionUser } from '../server/store.js';
import { createApp } from '../server/app.js';

async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-skills-'));
    const path = join(directory, 'test.db');
    const database = openDatabase(path);
    provisionUser(database, 'skill@example.com', 'test-skills-password');
    const legacyId = 'legacy-skill';
    database.prepare('INSERT INTO skills (id,name,description,content,updated_at) VALUES (?,?,?,?,?)').run(legacyId, 'Legacy', '', '# Legacy', '2026-01-01');
    let upstream = 'initial';
    let onFetch: (() => void) | undefined;
    const skillFetch = async (url: string) => {
        const callback = onFetch; onFetch = undefined; callback?.();
        if (upstream === 'offline') throw new Error('upstream offline');
        const parsed = new URL(url);
        assert(['api.github.com', 'raw.githubusercontent.com'].includes(parsed.hostname));
        if (parsed.pathname === '/repos/acme/tools') return Buffer.from(JSON.stringify({ private: false, default_branch: 'main' }));
        if (parsed.pathname === '/repos/acme/tools/git/trees/main') return Buffer.from(JSON.stringify({ sha: 'a'.repeat(40), truncated: false, tree: [
            { path: 'skills/review/SKILL.md', type: 'blob', sha: 'main' },
            { path: 'skills/review/references/check.md', type: 'blob', sha: 'reference' },
            { path: 'skills/review/scripts/demo.js', type: 'blob', sha: 'script' },
            { path: 'skills/review/.env', type: 'blob', sha: 'secret' },
            { path: 'skills/review/LICENSE', type: 'blob', sha: 'license' },
        ] }));
        if (parsed.hostname === 'raw.githubusercontent.com') {
            const content = parsed.pathname.endsWith('/SKILL.md') ? `---\nname: review\ndescription: ${upstream}\nallowed-tools: [Read, Bash]\ncustom:\n  keep: true\n---\n# Review\n${upstream}` : parsed.pathname.endsWith('/references/check.md') ? '# Check\nText reference' : 'globalThis.__unsafe = true';
            return Buffer.from(content);
        }
        throw new Error('Unexpected URL: ' + url);
    };
    const app = createApp({ database: path, origin: 'http://localhost', secure: false, ...{ skillFetch } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'skill@example.com', password: 'test-skills-password' }) });
    const session = await login.json();
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const request = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(base + path, { method, headers: { Origin: 'http://localhost', Cookie: cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await response.text();
        return { status: response.status, data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
    };
    return { request, database, path, app, base, legacyId, setUpstream(value: string) { upstream = value; }, onNextFetch(callback: () => void) { onFetch = callback; }, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); app.locals.database.close(); database.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const source = 'https://github.com/acme/tools/tree/main/skills/review';

test('Skill creation is URL-only and legacy resources survive migration', async () => {
    const context = await fixture();
    try {
        assert.equal((await context.request('/api/skills', 'POST', { name: 'Manual', content: '# text' })).status, 400);
        const old = await context.request('/api/skills/' + context.legacyId);
        assert.equal(old.data.content, '# Legacy');
        assert.equal((await context.request(`/api/skills/${context.legacyId}/refresh`, 'POST')).status, 422);
    } finally { await context.close(); }
});
test('URL import persists a text bundle, provenance and adding member, ignoring secrets and licenses', async () => {
    const context = await fixture();
    try {
        const result = await context.request('/api/skills/import', 'POST', { url: source });
        assert.equal(result.status, 201);
        assert.equal(result.data.status, 'created');
        const skill = (await context.request('/api/skills/' + result.data.skill.id)).data;
        assert.equal(skill.name, 'review');
        assert.equal(skill.description, 'initial');
        assert.equal(skill.source_url, source);
        assert.equal(skill.created_by_email, 'skill@example.com');
        assert.deepEqual(skill.files.map((file: { path: string }) => file.path), ['references/check.md', 'scripts/demo.js']);
        assert.match(skill.files[1].content, /__unsafe/);
        const reopened = openDatabase(context.path);
        assert.equal((reopened.prepare('SELECT name FROM skills WHERE id=?').get(skill.id) as { name: string }).name, 'review');
        reopened.close();
    } finally { await context.close(); }
});
test('import conflicts require explicit overwrite, rename or skip without data loss', async () => {
    const context = await fixture();
    try {
        const initial = await context.request('/api/skills/import', 'POST', { url: source });
        assert.equal(initial.status, 201);
        context.setUpstream('changed');
        const conflict = await context.request('/api/skills/import', 'POST', { url: source });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.data.existing_skill.id, initial.data.skill.id);
        assert.equal((await context.request('/api/skills/' + initial.data.skill.id)).data.description, 'initial');
        const skipped = await context.request('/api/skills/import', 'POST', { url: source, on_conflict: 'skip' });
        assert.equal(skipped.data.status, 'skipped');
        const replaced = await context.request('/api/skills/import', 'POST', { url: source, on_conflict: 'overwrite' });
        assert.equal(replaced.data.skill.id, initial.data.skill.id);
        assert.equal(replaced.data.skill.description, 'changed');
        const renamed = await context.request('/api/skills/import', 'POST', { url: source, on_conflict: 'rename' });
        assert.equal(renamed.data.skill.name, 'review-2');
        assert.match(renamed.data.skill.content, /name: review-2/);
    } finally { await context.close(); }
});
test('properties and SKILL.md stay synchronized while unknown frontmatter and files survive edits', async () => {
    const context = await fixture();
    try {
        const result = await context.request('/api/skills/import', 'POST', { url: source });
        assert.equal(result.status, 201);
        const path = '/api/skills/' + result.data.skill.id;
        const edited = await context.request(path, 'PATCH', { name: 'local-review', description: 'new summary', labels: ['Team', 'Review'] });
        assert.equal(edited.status, 200);
        assert.match(edited.data.content, /name: local-review/);
        assert.match(edited.data.content, /custom:\n  keep: true/);
        const main = await context.request(path, 'PATCH', { content: '---\nname: from-file\ndescription: |\n  First line\n  Second line\ncustom: retained\n---\n# Body' });
        assert.equal(main.data.name, 'from-file');
        assert.equal(main.data.description, 'First line\nSecond line\n');
        assert.deepEqual(main.data.labels, ['Team', 'Review']);
        const file = await context.request(path + '/files', 'PUT', { path: 'references/new.md', content: '# New reference' });
        assert.equal(file.status, 200);
        assert.equal(file.data.files.length, 3);
        assert.equal((await context.request(path + '/files', 'PUT', { path: '../escape', content: 'bad' })).status, 400);
        assert.equal((await context.request(path + '/files', 'PUT', { path: 'SKILL.md', content: 'bad' })).status, 400);
        assert.equal((await context.request(path + '/files', 'DELETE', { path: 'references/new.md' })).status, 200);
    } finally { await context.close(); }
});
test('source refresh replaces files atomically, keeps labels and identity, and leaves content on network failure', async () => {
    const context = await fixture();
    try {
        const result = await context.request('/api/skills/import', 'POST', { url: source });
        assert.equal(result.status, 201);
        const path = '/api/skills/' + result.data.skill.id;
        await context.request(path, 'PATCH', { labels: ['keep'] });
        await context.request(path + '/files', 'PUT', { path: 'local.md', content: 'local' });
        context.setUpstream('refreshed');
        const refresh = await context.request(path + '/refresh', 'POST');
        assert.equal(refresh.status, 200);
        assert.equal(refresh.data.id, result.data.skill.id);
        assert.equal(refresh.data.created_at, result.data.skill.created_at);
        assert.equal(refresh.data.description, 'refreshed');
        assert.deepEqual(refresh.data.labels, ['keep']);
        assert.equal(refresh.data.files.length, 2);
        context.setUpstream('offline');
        assert.equal((await context.request(path + '/refresh', 'POST')).status, 502);
        assert.deepEqual((await context.request(path)).data, refresh.data);
        await context.request(path, 'DELETE');
        assert.equal((await context.request(path)).status, 404);
        assert.equal((context.database.prepare('SELECT count(*) AS count FROM skill_files WHERE skill_id=?').get(result.data.skill.id) as { count: number }).count, 0);
    } finally { await context.close(); }
});
test('unsupported URL sources and unsafe URLs never enter an import', async () => {
    const context = await fixture();
    try {
        for (const url of ['http://127.0.0.1/internal', 'https://github.com.evil.test/acme/repo', 'https://user:secret@github.com/acme/repo', 'https://github.com:8443/acme/repo', 'file:///etc/passwd', 'https://gitee.com/acme/repo']) {
            assert.equal((await context.request('/api/skills/import', 'POST', { url })).status, 400, url);
        }
    } finally { await context.close(); }
});

test('skills.sh resolves exact bundles and ClawHub is explicitly rejected', async () => {
    const context = await fixture();
    try {
        const result = await context.request('/api/skills/import', 'POST', { url: 'https://skills.sh/acme/tools/review' });
        assert.equal(result.status, 201);
        assert.equal(result.data.skill.source_type, 'skills.sh');
        assert.equal((await context.request('/api/skills/import', 'POST', { url: 'https://clawhub.ai/acme/review' })).status, 400);
    } finally { await context.close(); }
});

test('real MCP imports URL bundles and shares property, file and source refresh rules with the web', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const context = await fixture();
    const client = new Client({ name: 'skill-test', version: '1' });
    try {
        const token = await context.request('/api/tokens', 'POST', { name: 'Skill test' });
        await client.connect(new StreamableHTTPClientTransport(new URL(context.base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.data.token } } }));
        const tools = await client.listTools();
        assert.equal(tools.tools.some(tool => tool.name === 'create_skill'), false);
        const call = async (name: string, args: Record<string, unknown>) => {
            const result = await client.callTool({ name, arguments: args });
            assert.notEqual(result.isError, true, JSON.stringify(result));
            return JSON.parse((result.content as { text: string }[])[0].text);
        };
        const imported = await call('import_skill', { url: source });
        assert.equal(imported.status, 'created');
        await call('update_skill', { id: imported.skill.id, labels: ['MCP'] });
        const file = await call('write_skill_file', { id: imported.skill.id, path: 'notes.md', content: '# Note' });
        assert.equal(file.files.length, 3);
        context.setUpstream('mcp-refreshed');
        const refreshed = await call('refresh_skill', { id: imported.skill.id });
        assert.equal(refreshed.description, 'mcp-refreshed');
        assert.deepEqual(refreshed.labels, ['MCP']);
        assert.equal((await context.request('/api/skills/' + imported.skill.id)).data.description, 'mcp-refreshed');
    } finally { await client.close(); await context.close(); }
});

test('malformed metadata and conflicting identities cannot overwrite another skill or its content', async () => {
    const context = await fixture();
    try {
        const imported = await context.request('/api/skills/import', 'POST', { url: source });
        const path = '/api/skills/' + imported.data.skill.id;
        for (const input of [{ name: null }, { name: { nested: 'bad' } }, { description: ['bad'] }, { content: '---\nname: [bad]\n---\n# Body' }, { content: '---\nname: review\nname: duplicate\n---\nbody' }, { labels: [null] }]) {
            assert.equal((await context.request(path, 'PATCH', input)).status, 400);
        }
        assert.equal((await context.request(path, 'PATCH', { name: 'Legacy' })).status, 409);
        assert.equal((await context.request(path)).data.name, 'review');
        assert.equal((await context.request(path)).data.description, 'initial');
        assert.equal((await context.request(path + '/files', 'PUT', { path: 'oversize.md', content: 'a'.repeat(1024 * 1024 + 1) })).status, 413);
    } finally { await context.close(); }
});
test('source refresh detects a same-millisecond concurrent edit without discarding it', async () => {
    const context = await fixture();
    try {
        const imported = await context.request('/api/skills/import', 'POST', { url: source });
        const path = '/api/skills/' + imported.data.skill.id;
        const initial = (await context.request(path)).data;
        context.onNextFetch(() => context.database.prepare('UPDATE skills SET description=? WHERE id=?').run('Concurrent edit', initial.id));
        assert.equal((await context.request(path + '/refresh', 'POST')).status, 409);
        assert.equal((await context.request(path)).data.description, 'Concurrent edit');
    } finally { await context.close(); }
});

test('editing a legacy Skill creates synchronized frontmatter instead of leaving properties out of the main file', async () => {
    const context = await fixture();
    try {
        const response = await context.request('/api/skills/' + context.legacyId, 'PATCH', { content: '# New legacy body' });
        assert.equal(response.status, 200);
        assert.match(response.data.content, /name: Legacy/);
        assert.match(response.data.content, /# New legacy body/);
    } finally { await context.close(); }
});

test('opening a pre-feature database adds Skill metadata without rewriting saved resources', async () => {
    const Database = (await import('better-sqlite3')).default;
    const directory = mkdtempSync(join(tmpdir(), 'xteam-skill-migration-'));
    const path = join(directory, 'old.db');
    const old = new Database(path);
    old.exec("CREATE TABLE skills (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,content TEXT NOT NULL,updated_at TEXT NOT NULL); INSERT INTO skills VALUES ('old','Old','Summary','# Untouched','2026-01-01')");
    old.close();
    const database = openDatabase(path);
    try {
        const row = database.prepare('SELECT * FROM skills WHERE id=?').get('old') as Record<string, unknown>;
        assert.equal(row.content, '# Untouched');
        assert.equal(row.source_url, '');
        assert.equal(row.created_by, '');
        assert.equal(row.labels, '[]');
        const second = openDatabase(path); second.close();
        assert.equal((database.prepare('SELECT count(*) AS count FROM skills').get() as { count: number }).count, 1);
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
