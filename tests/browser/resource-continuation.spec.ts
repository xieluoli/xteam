import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function login(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    return { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': (await (await page.request.get('/api/me')).json()).csrf };
}
async function project(page: Page, headers: Record<string, string>) {
    return (await page.request.post('/api/projects', { headers, data: { name: '交接 / 中文:' + randomUUID(), description: '项目背景\n外部设备接续约定' } })).json();
}
async function choose(page: Page, label: string, name: string) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
}
async function downloaded(page: Page, name: string) {
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const file = await ready;
    return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}

test('single Todo handoff preserves identity, background and exact description in copy and download', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page), value = await project(page, headers);
    const description = '<script>纯文本</script>\r\n' + '长中文说明。'.repeat(400) + '\n末行\n';
    const todo = await (await page.request.post('/api/todos', { headers, data: { project_id: value.id, title: '交接 / 同名:', description } })).json();
    const url = `http://127.0.0.1:3199/#project/${value.id}/todo/${todo.id}`;
    await page.goto(url);
    await page.getByRole('button', { name: '复制 Todo 上下文', exact: true }).click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    for (const field of [value.name, value.id, value.description, todo.title, todo.id, url, '未完成', description]) expect(text).toContain(field);
    const file = await downloaded(page, '下载 Todo 上下文');
    expect(file.text).toBe(text);
    expect(file.name).toMatch(/\.md$/);
    expect(file.name).not.toMatch(/[/:\\<>"|?*]/);
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: '复制 Todo 上下文', exact: true }).click();
    await expect(page.getByLabel('Todo 上下文手动复制')).toHaveValue(text.replace(/\r\n/g, '\n'));
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('button', { name: '下载 Todo 上下文', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.request.patch('/api/todos/' + todo.id, { headers, data: { description: '', completed: true } });
    await page.reload();
    expect((await downloaded(page, '下载 Todo 上下文')).text).toContain('已完成\n\n## Todo 说明\n\n未填写');
});

test('project export distinguishes duplicate Todo titles by stable ID and URL with status scopes', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page), value = await project(page, headers), todos = [];
    for (const completed of [false, true]) todos.push(await (await page.request.post('/api/todos', { headers, data: { project_id: value.id, title: '同名任务', completed } })).json());
    await page.goto('/#project/' + value.id);
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    for (const todo of todos) {
        expect(text).toContain(todo.id);
        expect(text).toContain(`http://127.0.0.1:3199/#project/${value.id}/todo/${todo.id}`);
    }
    expect((await downloaded(page, '下载项目上下文')).text).toBe(text);
    await choose(page, 'Todo 完成状态', '未完成');
    const incomplete = (await downloaded(page, '下载项目上下文')).text;
    expect(incomplete).toContain(todos[0].id);
    expect(incomplete).not.toContain(todos[1].id);
    await choose(page, 'Todo 完成状态', '已完成');
    const complete = (await downloaded(page, '下载项目上下文')).text;
    expect(complete).toContain(todos[1].id);
    expect(complete).not.toContain(todos[0].id);
    await page.request.delete('/api/todos/' + todos[1].id, { headers });
    await page.getByRole('button', { name: '刷新项目', exact: true }).click();
    await expect(page.getByText('没有已完成的 Todo。', { exact: true })).toBeVisible();
    expect((await downloaded(page, '下载项目上下文')).text).toContain('暂无 Todo');
});

test('Todo detail refresh reads real MCP writes and deletion, preserves drafts and recovers from read failure', async ({ page }) => {
    const headers = await login(page), value = await project(page, headers);
    const todo = await (await page.request.post('/api/todos', { headers, data: { project_id: value.id, title: '外部回写', description: '旧结果' } })).json();
    const url = '/#project/' + value.id + '/todo/' + todo.id;
    await page.goto(url);
    await expect(page.getByTestId('todo-description')).toHaveText('旧结果');
    const token = await (await page.request.post('/api/tokens', { headers, data: { name: 'todo-detail-test' } })).json();
    const client = new Client({ name: 'todo-detail-test', version: '1' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', page.url()), { requestInit: { headers: { Authorization: `Bearer ${token.token}` } } }));
        expect((await client.callTool({ name: 'update_todo', arguments: { id: todo.id, description: 'MCP新结果', completed: true } })).isError).not.toBe(true);
        await page.getByRole('button', { name: '刷新 Todo', exact: true }).click();
        await expect(page.getByTestId('todo-description')).toHaveText('MCP新结果');
        await expect(page.getByRole('checkbox', { name: '外部回写', exact: true })).toBeChecked();
        await expect(page).toHaveURL(new RegExp(url.replace('/#', '#') + '$'));
        await page.getByRole('button', { name: '编辑 / 记录结果', exact: true }).click();
        await page.getByLabel('完成结果', { exact: true }).fill('未保存草稿');
        await client.callTool({ name: 'update_todo', arguments: { id: todo.id, description: '另一次回写', completed: true } });
        await expect(page.getByRole('button', { name: '刷新 Todo', exact: true, includeHidden: true })).toBeDisabled();
        await expect(page.getByLabel('完成结果', { exact: true })).toHaveValue('未保存草稿');
        await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
        await page.getByRole('button', { name: '放弃修改', exact: true }).click();
        await page.route('**/api/projects/' + value.id + '/context', route => route.fulfill({ status: 503, json: { error: '读取临时失败' } }));
        await page.getByRole('button', { name: '刷新 Todo', exact: true }).click();
        await expect(page.getByTestId('refresh-feedback')).toContainText('已保留当前内容');
        await expect(page.getByTestId('todo-description')).toHaveText('MCP新结果');
        await page.unroute('**/api/projects/' + value.id + '/context');
        await page.getByRole('button', { name: '刷新 Todo', exact: true }).click();
        await expect(page.getByTestId('todo-description')).toHaveText('另一次回写');
        await client.callTool({ name: 'delete_todo', arguments: { id: todo.id } });
        await page.getByRole('button', { name: '刷新 Todo', exact: true }).click();
        await expect(page.getByText('Todo 不存在或已删除。', { exact: true })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(url.replace('/#', '#') + '$'));
        await expect(page.getByRole('button', { name: '刷新 Todo', exact: true })).toBeVisible();
    } finally {
        await client.close();
        await page.request.delete('/api/tokens/' + token.id, { headers });
    }
});

for (const width of [390, 320]) test(`saved Skill file downloads exact selected bytes without discarding drafts at ${width}px`, async ({ page }) => {
    const headers = await login(page);
    const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/single', on_conflict: 'rename' } })).json();
    const id = imported.skill.id;
    const files = [{ path: 'references/shared.md', content: '参考目录\r\n中文末行\n' }, { path: 'scripts/shared.md', content: '<script>文本</script>\n' }, { path: 'references/中文.txt', content: '' }];
    try {
        for (const file of files) await page.request.put('/api/skills/' + id + '/files', { headers, data: file });
        const saved = await (await page.request.get('/api/skills/' + id)).json();
        await page.goto('/#skill/' + id);
        await page.setViewportSize({ width, height: 844 });
        await page.getByRole('tab', { name: '文件 ' + (saved.files.length + 1), exact: true }).click();
        expect((await downloaded(page, '下载已保存文件')).text).toBe(saved.content);
        for (const file of files) {
            await page.getByRole('button', { name: file.path, exact: true }).click();
            const actual = await downloaded(page, '下载已保存文件');
            expect(actual.text).toBe(file.content);
            expect(actual.name).toContain(file.path.replace('/', '-'));
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.getByRole('button', { name: files[0].path, exact: true }).click();
        await page.getByRole('button', { name: '编辑文件', exact: true }).click();
        await page.getByRole('textbox', { name: '文件正文', exact: true }).fill('未保存新草稿');
        expect((await downloaded(page, '下载已保存文件')).text).toBe(files[0].content);
        await expect(page.getByRole('textbox', { name: '文件正文', exact: true })).toHaveValue('未保存新草稿');
        await page.getByRole('button', { name: files[1].path, exact: true }).click();
        await expect(page.getByRole('alertdialog')).toContainText('未保存');
        await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
        await expect(page.getByRole('textbox', { name: '文件正文', exact: true })).toHaveValue('未保存新草稿');
    } finally { await page.request.delete('/api/skills/' + id, { headers }); }
});

test('project links combine title or URL search with category and reset between projects without narrowing export', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page), value = await project(page, headers), other = await project(page, headers);
    const links = [
        { title: '代码 需求', url: 'https://github.com/example/spec', category: 'github' },
        { title: '需求文档', url: 'https://example.com/spec', category: 'other' },
        { title: '安全地址', url: 'https://example.com/a?q=%3Cscript%3E', category: 'other' },
    ];
    for (const link of links) await page.request.post('/api/links', { headers, data: { project_id: value.id, ...link } });
    await page.goto('/#project/' + value.id);
    await page.getByRole('textbox', { name: '搜索关联链接', exact: true }).fill('SPEC');
    await expect(page.locator('.link-list > li')).toHaveCount(2);
    await choose(page, '链接类别', 'GitHub');
    await expect(page.locator('.link-list > li')).toHaveCount(1);
    await expect(page.locator('.link-list a')).toHaveAttribute('target', '_blank');
    await expect(page.locator('.link-list a')).toHaveAttribute('rel', 'noopener noreferrer');
    const exported = (await downloaded(page, '下载项目上下文')).text;
    for (const link of links) expect(exported).toContain(link.url);
    await page.getByRole('textbox', { name: '搜索关联链接', exact: true }).fill('无结果');
    await expect(page.getByText('没有匹配的链接。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清除链接筛选', exact: true }).click();
    await expect(page.locator('.link-list > li')).toHaveCount(3);
    await page.getByRole('textbox', { name: '搜索关联链接', exact: true }).fill('需求文档');
    await expect(page.locator('.link-list > li')).toHaveCount(1);
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('textbox', { name: '搜索关联链接', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.evaluate(id => { location.hash = 'project/' + id; }, other.id);
    await expect(page.getByRole('textbox', { name: '搜索关联链接', exact: true })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: '链接类别', exact: true })).toContainText('全部类别');
    await expect(page.locator('.link-list > li')).toHaveCount(0);
});


test('saved Skill file reports download failure and retries after a failed read', async ({ page }) => {
    const headers = await login(page);
    const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/single', on_conflict: 'rename' } })).json();
    const id = imported.skill.id;
    try {
        await page.route('**/api/skills/' + id, route => route.fulfill({ status: 503, json: { error: '临时读取失败' } }));
        await page.goto('/#skill/' + id);
        await expect(page.getByRole('button', { name: '重试读取 Skill', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '下载已保存文件', exact: true })).toHaveCount(0);
        await page.unroute('**/api/skills/' + id);
        await page.getByRole('button', { name: '重试读取 Skill', exact: true }).click();
        const saved = await (await page.request.get('/api/skills/' + id)).json();
        await page.getByRole('tab', { name: '文件 ' + (saved.files.length + 1), exact: true }).click();
        await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('download denied'); }; });
        await page.getByRole('button', { name: '下载已保存文件', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('下载失败，请重试');
        await expect(page.getByLabel('当前文件手动复制')).toHaveCount(0);
        await page.reload();
        await page.getByRole('tab', { name: '文件 ' + (saved.files.length + 1), exact: true }).click();
        expect((await downloaded(page, '下载已保存文件')).text).toBe(saved.content);
    } finally { await page.request.delete('/api/skills/' + id, { headers }); }
});

test('late clipboard rejection cannot expose the previous Todo context on another detail', async ({ page }) => {
    const headers = await login(page), value = await project(page, headers);
    const todos = [];
    for (const title of ['前一任务', '当前任务']) todos.push(await (await page.request.post('/api/todos', { headers, data: { project_id: value.id, title, description: title + '正文' } })).json());
    await page.goto('/#project/' + value.id + '/todo/' + todos[0].id);
    await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise((_, reject) => { (window as any).rejectTodoCopy = reject; }); });
    await page.getByRole('button', { name: '复制 Todo 上下文', exact: true }).click();
    await page.evaluate(id => { location.hash = id; }, 'project/' + value.id + '/todo/' + todos[1].id);
    await expect(page.getByRole('heading', { name: '当前任务', exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).rejectTodoCopy(new Error('delayed clipboard denial')));
    await expect(page.getByLabel('Todo 上下文手动复制')).toHaveCount(0);
    await expect(page.getByTestId('todo-description')).toHaveText('当前任务正文');
});
