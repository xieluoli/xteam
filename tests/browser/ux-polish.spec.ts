import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function login(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    const session = await (await page.request.get('/api/me')).json();
    return { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
}

test('project actions report beside their resource and keep unrelated Todo actions available', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const project = await (await page.request.post('/api/projects', { headers, data: { name: `交接-${randomUUID()}`, description: '项目背景' } })).json();
    const link = await (await page.request.post('/api/links', { headers, data: { project_id: project.id, title: '很长的资料入口', url: 'https://example.com/' + 'path/'.repeat(40) } })).json();
    const first = await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '第一项', description: '待执行说明' } })).json();
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '第二项' } });
    await page.goto(`/#project/${project.id}`);

    await page.getByRole('button', { name: `复制链接 ${link.title}`, exact: true }).click();
    await expect(page.getByTestId(`link-feedback-${link.id}`)).toContainText('链接已复制');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link.url);
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    await expect(page.getByTestId('context-feedback')).toContainText('复制失败');
    await expect(page.getByLabel('项目上下文手动复制')).toContainText(project.name);
    await page.getByRole('button', { name: '复制 ID', exact: true }).click();
    await expect(page.getByTestId('project-id-feedback')).toContainText('复制失败');
    await expect(page.getByLabel('项目 ID 手动复制')).toHaveValue(project.id);

    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/todos/${first.id}`, async route => { await pending; await route.continue(); });
    await page.getByRole('checkbox', { name: '第一项', exact: true }).click();
    await expect(page.getByTestId(`todo-feedback-${first.id}`)).toContainText('保存中');
    await expect(page.getByRole('checkbox', { name: '第一项', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: '第二项', exact: true })).toBeEnabled();
    await page.getByRole('checkbox', { name: '第二项', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '第二项', exact: true })).toBeChecked();
    release();
    await expect(page.getByTestId(`todo-feedback-${first.id}`)).toContainText('已保存');

    await page.getByRole('button', { name: '编辑 / 记录结果', exact: true }).first().click();
    await expect(page.getByLabel('完成结果', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '添加 Todo', exact: true }).click();
    await expect(page.getByLabel('行动说明', { exact: true })).toBeVisible();
});

test('Agent and MCP actions use specific labels, local feedback, empty states and local pending', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const agent = await (await page.request.post('/api/agents', { headers, data: { name: `交接助手-${randomUUID()}`, content: '# 团队指令' } })).json();
    const agents = await (await page.request.get('/api/agents', { headers })).json();
    await page.getByRole('link', { name: 'Agent 模板', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建 Agent 模板', exact: true })).toBeVisible();
    await expect(page.getByText(`${agents.length} 个 Agent 模板`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `打开 Agent 模板 ${agent.name}`, exact: true }).click();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: '复制 Agent 正文', exact: true }).click();
    await expect(page.getByTestId('agent-copy-feedback')).toContainText('复制失败');
    await expect(page.getByLabel('Agent 正文手动复制')).toHaveValue('# 团队指令');
    await page.getByRole('button', { name: '关闭', exact: true }).click();

    await page.getByRole('link', { name: 'MCP 接入', exact: true }).click();
    await expect(page.getByText('尚未创建个人令牌。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '复制地址', exact: true }).click();
    await expect(page.getByTestId('mcp-address-feedback')).toContainText('复制失败');
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/tokens', async route => route.request().method() === 'POST' ? (await pending, route.continue()) : route.continue());
    await page.getByLabel('令牌名称', { exact: true }).fill('本地 pending');
    await page.getByRole('button', { name: '创建令牌', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建中…', exact: true })).toBeDisabled();
    release();
    await expect(page.getByLabel('新令牌', { exact: true })).toBeFocused();
    await expect(page.getByText('撤销后使用此令牌的客户端会立即断开。', { exact: true })).toBeVisible();
    const tokens = await (await page.request.get('/api/tokens', { headers })).json();
    for (const token of tokens.filter((item: { name: string }) => item.name === '本地 pending')) await page.request.delete('/api/tokens/' + token.id, { headers });
});

test('Skill details use Chinese hierarchy and expose the current file on narrow screens', async ({ page }) => {
    const headers = await login(page);
    const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/components', on_conflict: 'rename' } })).json();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#skill/${imported.skill.id}`);
    await expect(page.getByRole('link', { name: '返回 Skill 库', exact: true })).toContainText('Skill 库');
    await expect(page.getByRole('tab', { name: '概览', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /文件/ }).click();
    await expect(page.getByRole('heading', { name: '属性', exact: true })).toHaveCount(0);
    await expect(page.getByText('主文件', { exact: true })).toBeVisible();
    await expect(page.getByTestId('current-skill-file')).toContainText('SKILL.md');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('dialogs explain the resource, navigation focuses the page title, and expired sessions leave no stale workspace', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('创建项目背景，供团队与外部 Agent 接续工作。');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '切换侧边栏', exact: true }).click();
    await page.getByRole('link', { name: 'Agent 模板', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Agent 模板', exact: true })).toBeFocused();

    await page.route('**/api/projects?*', route => route.fulfill({ status: 401, json: { error: '请先登录' } }));
    await page.getByRole('button', { name: '切换侧边栏', exact: true }).click();
    await page.getByRole('link', { name: '项目', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toHaveCount(0);
});
