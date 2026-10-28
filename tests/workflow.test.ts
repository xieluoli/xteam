import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase, provisionUser, disableUser } from '../server/store.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-flow-'));
    const path = join(directory, 'data.db');
    const database = openDatabase(path);
    provisionUser(database, 'one@example.com', 'test-password-one');
    provisionUser(database, 'two@example.com', 'test-password-two');
    const app = createApp({ database: path, origin: 'http://localhost', secure: false });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    async function login(email = 'one@example.com', password = 'test-password-one') {
        const response = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        assert.equal(response.status, 200);
        const session = await response.json();
        const cookie = response.headers.get('set-cookie')!.split(';')[0];
        return async (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => {
            const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
            const text = await response.text();
            return { status: response.status, data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
        };
    }
    return { database, path, base, login, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); app.locals.database.close(); database.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('members share CRUD, context and persisted results without cross-project deletion', async () => {
    const context = await fixture();
    try {
        const request = await context.login();
        for (const entity of ['agents']) {
            const created = await request('/api/' + entity, 'POST', { name: 'Writer', description: 'Team resource', content: '# Instructions' });
            assert.equal(created.status, 201);
            assert.equal((await request(`/api/${entity}?q=absent`)).data.length, 0);
            assert.equal((await request(`/api/${entity}/${created.data.id}`, 'PATCH', { content: '# Updated' })).data.content, '# Updated');
        }
        const project = await request('/api/projects', 'POST', { name: 'Launch', description: 'Release context' });
        assert.equal(project.status, 201);
        const other = await request('/api/projects', 'POST', { name: 'Other' });
        const link = await request('/api/links', 'POST', { project_id: project.data.id, title: 'Repo', url: 'https://github.com/example/repo', category: 'github' });
        assert.equal(link.status, 201);
        assert.equal((await request('/api/links', 'POST', { project_id: project.data.id, title: 'Unsafe', url: 'javascript:alert(1)' })).status, 400);
        assert.equal((await request('/api/todos', 'POST', { project_id: 'missing', title: 'Orphan' })).status, 404);
        const todo = await request('/api/todos', 'POST', { project_id: project.data.id, title: 'Ship' });
        const unrelated = await request('/api/todos', 'POST', { project_id: other.data.id, title: 'Keep me' });
        assert.equal((await request(`/api/todos/${todo.data.id}`, 'PATCH', { completed: true, description: 'Result: https://example.com/release' })).data.completed, true);
        const second = await context.login('two@example.com', 'test-password-two');
        const shared = await second(`/api/projects/${project.data.id}/context`);
        assert.equal(shared.data.todos[0].description, 'Result: https://example.com/release');
        assert.equal(shared.data.links[0].url, 'https://github.com/example/repo');
        const reopened = openDatabase(context.path);
        assert.equal((reopened.prepare('SELECT completed FROM todos WHERE id=?').get(todo.data.id) as {
            completed: number;
        }).completed, 1);
        reopened.close();
        assert.equal((await request(`/api/projects/${project.data.id}`, 'DELETE')).status, 200);
        assert.equal((await request('/api/links?project_id=' + project.data.id)).data.length, 0);
        assert.equal((await request(`/api/todos/${unrelated.data.id}`)).data.title, 'Keep me');
        assert.equal((await request('/api/agents')).data.length, 1);
    }
    finally {
        await context.close();
    }
});
test('CSRF, bad credentials, ownership, password change and member disabling enforce access', async () => {
    const context = await fixture();
    try {
        for (const email of ['unknown@example.com', 'one@example.com']) {
            assert.equal((await fetch(context.base + '/api/login', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'wrong-password' }) })).status, 401);
        }
        assert.equal((await fetch(context.base + '/api/projects')).status, 401);
        const request = await context.login();
        assert.equal((await request('/api/projects', 'POST', { name: 'Blocked' }, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await request('/api/projects', 'POST', { name: 'Blocked' }, { Origin: 'https://evil.example' })).status, 403);
        const token = await request('/api/tokens', 'POST', { name: 'Personal' });
        assert.equal(token.status, 201);
        const second = await context.login('two@example.com', 'test-password-two');
        assert.equal((await second('/api/tokens')).data.length, 0);
        assert.equal((await second('/api/tokens/' + token.data.id, 'DELETE')).status, 404);
        assert.equal((await request('/api/password', 'POST', { current: 'test-password-one', password: 'new-test-password' })).status, 200);
        assert.equal((await request('/api/me')).status, 401);
        const fresh = await context.login('one@example.com', 'new-test-password');
        disableUser(context.database, 'one@example.com');
        assert.equal((await fresh('/api/me')).status, 401);
        assert.equal((await fetch(context.base + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token.data.token, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    }
    finally {
        await context.close();
    }
});
test('real MCP client reads project context and writes results; revoked tokens stop working', async () => {
    const context = await fixture();
    const client = new Client({ name: 'xteam-test', version: '1.0.0' });
    try {
        const request = await context.login();
        const token = await request('/api/tokens', 'POST', { name: 'MCP test' });
        assert.equal(token.status, 201);
        assert.equal((await request('/api/tokens')).data[0].token, undefined);
        const transport = new StreamableHTTPClientTransport(new URL(context.base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.data.token } } });
        await client.connect(transport);
        const tools = await client.listTools();
        assert.ok(tools.tools.some(tool => tool.name === 'get_project_context'));
        const call = async (name: string, args: Record<string, unknown>) => {
            const result = await client.callTool({ name, arguments: args });
            assert.notEqual(result.isError, true, JSON.stringify(result));
            return JSON.parse((result.content as {
                text: string;
            }[])[0].text);
        };
        const project = await call('create_project', { name: 'MCP Project', description: 'Context' });
        const todo = await call('create_todo', { project_id: project.id, title: 'Read and write' });
        await call('update_todo', { id: todo.id, completed: true, description: 'Finished by external client' });
        const result = await call('get_project_context', { id: project.id });
        assert.equal(result.todos[0].completed, true);
        assert.equal((await request('/api/todos/' + todo.id)).data.description, 'Finished by external client');
        await request('/api/tokens/' + token.data.id, 'DELETE');
        await assert.rejects(() => client.listTools());
    }
    finally {
        await client.close();
        await context.close();
    }
});
