import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDatabase, provisionUser } from '../server/store.js';
import { createApp } from '../server/app.js';
import { skillNetwork } from './skill-network.js';

async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-context-filters-'));
    const path = join(directory, 'test.db');
    const database = openDatabase(path);
    provisionUser(database, 'filters@example.com', 'filters-test-password');
    database.close();
    const app = createApp({ database: path, origin: 'http://localhost', secure: false, skillFetch: skillNetwork });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'filters@example.com', password: 'filters-test-password' }) });
    const session = await login.json();
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const request = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(base + path, { method, headers: { Origin: 'http://localhost', Cookie: cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
    };
    const token = await request('/api/tokens', 'POST', { name: 'context-filter-tests' });
    const client = new Client({ name: 'context-filter-tests', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token.data.token}` } } }));
    const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, JSON.stringify(result));
        return JSON.parse((result.content as { text: string }[])[0].text);
    };
    return { request, call, close: async () => { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); app.locals.database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('Todo completion filters combine with project and title and reject malformed query values', async () => {
    const context = await fixture();
    try {
        const project = (await context.request('/api/projects', 'POST', { name: 'Primary' })).data;
        const other = (await context.request('/api/projects', 'POST', { name: 'Other' })).data;
        const pending = (await context.request('/api/todos', 'POST', { project_id: project.id, title: 'Read context' })).data;
        const done = (await context.request('/api/todos', 'POST', { project_id: project.id, title: 'Read delivered', completed: true })).data;
        await context.request('/api/todos', 'POST', { project_id: other.id, title: 'Read foreign', completed: true });
        const list = `/api/todos?project_id=${project.id}`;
        assert.equal((await context.request(list)).data.length, 2);
        assert.deepEqual((await context.request(list + '&completed=false&q=Read')).data.map((todo: { id: string }) => todo.id), [pending.id]);
        assert.deepEqual((await context.request(list + '&completed=true&q=delivered')).data.map((todo: { id: string }) => todo.id), [done.id]);
        assert.deepEqual((await context.request(list + '&completed=false&q=absent')).data, []);
        for (const query of ['completed=yes', 'completed=0', 'completed=', 'completed=True', 'completed=false&completed=true']) {
            const response = await context.request(`/api/todos?${query}`);
            assert.equal(response.status, 400, query);
            assert.match(response.data.error, /completed/);
        }
        assert.equal((await context.request('/api/projects')).data.length, 2);
    } finally { await context.close(); }
});

test('MCP and HTTP expose the same completion-filtered Todo and project context without changing defaults', async () => {
    const context = await fixture();
    try {
        const project = await context.call('create_project', { name: 'Shared context', description: 'Do the next action' });
        await context.call('create_link', { project_id: project.id, title: 'Spec', url: 'https://example.com/spec' });
        const pending = await context.call('create_todo', { project_id: project.id, title: 'Next' });
        const done = await context.call('create_todo', { project_id: project.id, title: 'Delivered', description: 'Verified', completed: true });
        assert.equal((await context.call('list_todos', { project_id: project.id })).length, 2);
        assert.equal((await context.call('get_project_context', { id: project.id })).todos.length, 2);
        for (const completed of [false, true]) {
            const expected = completed ? done : pending;
            const list = await context.call('list_todos', { project_id: project.id, completed });
            assert.deepEqual(list.map((todo: { id: string }) => todo.id), [expected.id]);
            const result = await context.call('get_project_context', { id: project.id, completed });
            assert.deepEqual(result, (await context.request(`/api/projects/${project.id}/context?completed=${completed}`)).data);
            assert.deepEqual(result.todos.map((todo: { id: string }) => todo.id), [expected.id]);
            assert.equal(result.links.length, 1);
            assert.equal(result.project.description, 'Do the next action');
        }
        assert.equal((await context.request(`/api/projects/${project.id}/context?completed=invalid`)).status, 400);
        const metadata = await context.call('get_todo', { id: done.id });
        assert.equal(metadata.description, 'Verified');
    } finally { await context.close(); }
});

test('Skill label filters use exact metadata matches in HTTP and MCP and combine with names', async () => {
    const context = await fixture();
    try {
        const review = (await context.call('import_skill', { url: 'https://github.com/example/review' })).skill;
        const writer = (await context.call('import_skill', { url: 'https://github.com/example/writer' })).skill;
        await context.call('update_skill', { id: review.id, labels: ['产品', '研发'] });
        await context.call('update_skill', { id: writer.id, labels: ['产品指南'] });
        const result = await context.call('list_skills', { label: '产品', q: 'review' });
        assert.deepEqual(result.map((skill: { id: string }) => skill.id), [review.id]);
        assert.deepEqual(result, (await context.request('/api/skills?label=' + encodeURIComponent('产品') + '&q=review')).data);
        assert.equal(result[0].content, undefined);
        assert.equal(result[0].files, undefined);
        assert.equal((await context.call('list_skills', {})).length, 2);
        assert.deepEqual(await context.call('list_skills', { label: '产品', q: 'writer' }), []);
        assert.deepEqual(await context.call('list_skills', { label: '不存在' }), []);
        for (const query of ['label=', 'label=%20', 'label=one&label=two']) assert.equal((await context.request('/api/skills?' + query)).status, 400);
        assert.equal((await context.call('get_skill', { id: writer.id })).name, 'writer');
    } finally { await context.close(); }
});
