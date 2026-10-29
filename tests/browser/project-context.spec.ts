import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function login(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    const session = await (await page.request.get('/api/me')).json();
    return { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
}

async function createProject(page: Page, headers: Record<string, string>) {
    const response = await page.request.post('/api/projects', { headers, data: { name: `接续项目-${randomUUID()}`, description: '项目目标\n必要的团队约定' } });
    expect(response.status()).toBe(201);
    return response.json();
}

test('project read failures end loading and allow retry or return to the project list', async ({ page }) => {
    const headers = await login(page);
    const project = await createProject(page, headers);
    let unavailable = true;
    await page.route(`**/api/projects/${project.id}/context`, route => unavailable
        ? route.fulfill({ status: 503, json: { error: '项目读取暂不可用' } }) : route.continue());
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('alert')).toContainText('项目读取暂不可用');
    await expect(page.getByText('正在读取项目…', { exact: true })).toHaveCount(0);
    unavailable = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
    await page.goto(`/#project/${randomUUID()}`);
    await expect(page.getByRole('alert')).toContainText('资源不存在或已删除');
    await expect(page.getByText('正在读取项目…', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '← 所有项目', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
});

test('a successful save with a failed refresh closes the editor and never creates a duplicate', async ({ page }) => {
    const headers = await login(page);
    const name = `只保存一次-${randomUUID()}`;
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill(name);
    await page.route('**/api/projects?*', route => route.fulfill({ status: 503, json: { error: '列表暂不可用' } }));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('已保存');
    const list = await (await page.request.get('/api/projects', { headers })).json();
    expect(list.filter((project: { name: string }) => project.name === name)).toHaveLength(1);
    await page.unroute('**/api/projects?*');
    await page.reload();
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});

test('explicit refresh displays a real external MCP update', async ({ page }) => {
    const headers = await login(page);
    const project = await createProject(page, headers);
    const todo = await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '外部处理', description: '尚未回写' } })).json();
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByText('尚未回写', { exact: true })).toBeVisible();
    const token = await (await page.request.post('/api/tokens', { headers, data: { name: 'context-browser-test' } })).json();
    const client = new Client({ name: 'context-browser-test', version: '1' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', page.url()), { requestInit: { headers: { Authorization: `Bearer ${token.token}` } } }));
        const result = await client.callTool({ name: 'update_todo', arguments: { id: todo.id, description: '已验证，下一步交付', completed: true } });
        expect(result.isError).not.toBe(true);
        await expect(page.getByRole('button', { name: '刷新项目', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '刷新项目', exact: true }).click();
        await expect(page.getByText('已验证，下一步交付', { exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: '外部处理', exact: true })).toBeChecked();
    } finally {
        await client.close();
        await page.request.delete(`/api/tokens/${token.id}`, { headers });
    }
});

test('copy project context includes readable text and preserves clipboard failure feedback', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const project = await createProject(page, headers);
    await page.request.post('/api/links', { headers, data: { project_id: project.id, title: '需求资料', url: 'https://example.com/spec' } });
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '接着做', description: '阅读约定再开始' } });
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '已交付', completed: true } });
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('button', { name: '复制项目上下文', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    for (const text of [project.name, project.id, project.description, 'https://example.com/spec', '[ ] 接着做', '[x] 已交付', '阅读约定再开始']) expect(copied).toContain(text);
    expect(copied).not.toContain('xt_');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
    await expect(page.getByRole('button', { name: '复制项目上下文', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('复制失败');
    expect(await page.getByRole('status').count()).toBe(0);
});

test('a failed copy clears the previous success notification', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const project = await createProject(page, headers);
    await page.goto(`/#project/${project.id}`);
    await page.getByRole('button', { name: '复制 ID', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已复制');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
    await page.getByRole('button', { name: '复制 ID', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('复制失败');
    expect(await page.getByRole('status').count()).toBe(0);
});

test('Todo filters show matching empty states, update after completion, and reset across projects', async ({ page }) => {
    const headers = await login(page);
    const project = await createProject(page, headers);
    const other = await createProject(page, headers);
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '待处理行动' } });
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '交付完成', completed: true } });
    await page.request.post('/api/todos', { headers, data: { project_id: other.id, title: '另一项目行动' } });
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('checkbox', { name: '待处理行动', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Todo 完成状态', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Todo 完成状态', exact: true }).click();
    await page.getByRole('option', { name: '未完成', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '交付完成', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '待处理行动', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '待处理行动', exact: true })).toHaveCount(0);
    await expect(page.getByText('没有未完成的 Todo。', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Todo/ })).toContainText('2/2');
    await page.getByRole('combobox', { name: 'Todo 完成状态', exact: true }).click();
    await page.getByRole('option', { name: '已完成', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await page.evaluate(id => { location.hash = 'project/' + id; }, other.id);
    await expect(page.getByRole('heading', { name: other.name, exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Todo 完成状态', exact: true })).toContainText('全部');
    await expect(page.getByRole('checkbox', { name: '另一项目行动', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '待处理行动', exact: true })).toHaveCount(0);
});
