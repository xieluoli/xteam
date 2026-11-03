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
    return { request, call, client, close: async () => { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); app.locals.database.close(); rmSync(directory, { recursive: true, force: true }); } };
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

test('Todo handoff shares saved text and source IDs across HTTP/MCP and preserves result notes', async () => {
    const context = await fixture();
    try {
        const project = await context.call('create_project', { name: '接续项目', description: '项目背景' });
        const other = await context.call('create_project', { name: '其他项目' });
        const todo = await context.call('create_todo', { project_id: project.id, title: '接续任务', description: '已有设备备注\n## 已确认决定\n沿用文本' });
        const link = await context.call('create_link', { project_id: project.id, title: '依据', url: 'https://example.com/evidence' });
        await context.call('create_link', { project_id: other.id, title: '外部项目资料', url: 'https://example.com/foreign' });
        const route = `/api/projects/${project.id}/todos/${todo.id}/handoff`;
        const http = await context.request(route);
        assert.equal(http.status, 200);
        const mcp = await context.call('get_todo_handoff', { project_id: project.id, id: todo.id });
        assert.deepEqual(mcp, http.data);
        assert.equal(mcp.todo.description, todo.description);
        for (const text of [project.id, todo.id, link.id, '已有设备备注', '## 已确认决定', '沿用文本', '## 下一步', '未填写', '先读取最新 Todo', todo.updated_at, 'expected_updated_at']) assert.ok(mcp.text.includes(text), text);
        assert.ok(!mcp.text.includes('外部项目资料'));
        assert.equal((await context.request(`/api/projects/${other.id}/todos/${todo.id}/handoff`)).status, 404);
        const written = await context.call('update_todo', { id: todo.id, description: mcp.todo.description + '\n## 结果\n已验证：本地回归通过；上线未验证', completed: false });
        const next = (await context.request(route)).data;
        assert.equal(next.todo.description, written.description);
        assert.match(next.text, /已有设备备注/);
        assert.match(next.text, /上线未验证/);
        const empty = await context.call('create_todo', { project_id: project.id, title: '旧任务空说明' });
        const legacy = await context.call('get_todo_handoff', { project_id: project.id, id: empty.id });
        assert.equal(legacy.todo.description, '');
        assert.match(legacy.text, /未填写/);
        await context.call('delete_todo', { id: todo.id });
        assert.equal((await context.request(route)).status, 404);
    } finally { await context.close(); }
});

test('Conditional resource writes reject stale clients atomically across HTTP/MCP and keep legacy writes compatible', async () => {
    const context = await fixture();
    try {
        const project = await context.call('create_project', { name: '写入保护' });
        const todo = await context.call('create_todo', { project_id: project.id, title: '两个设备', description: '初始备注' });
        const first = await context.request('/api/todos/' + todo.id, 'PATCH', { description: '设备甲结果', expected_updated_at: todo.updated_at });
        assert.equal(first.status, 200);
        assert.ok(first.data.updated_at > todo.updated_at);
        const stale = await context.request('/api/todos/' + todo.id, 'PATCH', { completed: true, description: '设备乙旧内容', expected_updated_at: todo.updated_at });
        assert.equal(stale.status, 409);
        assert.match(stale.data.error, /重新读取/);
        assert.deepEqual(await context.call('get_todo', { id: todo.id }), first.data);
        const mcpConflict = await context.client.callTool({ name: 'update_todo', arguments: { id: todo.id, expected_updated_at: todo.updated_at, completed: true } });
        assert.equal(mcpConflict.isError, true);
        assert.match(JSON.stringify(mcpConflict.content), /重新读取/);
        const tools = (await context.call('get_project_context', { id: project.id })).todos;
        assert.equal(tools[0].updated_at, first.data.updated_at);
        const second = await context.call('update_todo', { id: todo.id, expected_updated_at: first.data.updated_at, description: first.data.description + '\n设备乙合并', completed: true });
        const results = await Promise.all([
            context.request('/api/todos/' + todo.id, 'PATCH', { title: '并发甲', expected_updated_at: second.updated_at }),
            context.request('/api/todos/' + todo.id, 'PATCH', { title: '并发乙', expected_updated_at: second.updated_at }),
        ]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        const final = await context.call('get_todo', { id: todo.id });
        assert.equal(final.description, second.description);
        assert.equal(final.completed, true);
        assert.equal((await context.request('/api/todos/' + todo.id, 'PATCH', { expected_updated_at: null })).status, 400);
        const legacy = await context.call('update_project', { id: project.id, description: '旧客户端兼容' });
        assert.equal(legacy.description, '旧客户端兼容');
        const staleProject = await context.request('/api/projects/' + project.id, 'PATCH', { name: '不得覆盖', expected_updated_at: project.updated_at });
        assert.equal(staleProject.status, 409);
        assert.equal((await context.request('/api/todos/' + todo.id, 'DELETE', { expected_updated_at: todo.updated_at })).status, 409);
        await context.call('delete_todo', { id: todo.id });
        assert.equal((await context.request('/api/todos/' + todo.id, 'PATCH', { title: '不能复活', expected_updated_at: final.updated_at })).status, 404);
    } finally { await context.close(); }
});
