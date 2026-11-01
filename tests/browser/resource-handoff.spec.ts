import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test.setTimeout(30000);
async function login(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    return { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': (await (await page.request.get('/api/me')).json()).csrf };
}
async function project(page: Page, headers: Record<string, string>) {
    return (await page.request.post('/api/projects', { headers, data: { name: '接续 / 中文:' + randomUUID(), description: '项目背景\n' + '长说明。'.repeat(300) } })).json();
}
async function choose(page: Page, label: string, name: string) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
}
async function downloadText(page: Page, button: string) {
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const download = await ready;
    return { name: download.suggestedFilename(), text: await readFile((await download.path())!, 'utf8') };
}

test('context download and filtered clipboard preserve background and links with exact matching bytes', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page), value = await project(page, headers);
    await page.request.post('/api/links', { headers, data: { project_id: value.id, title: '需求入口', url: 'https://example.com/spec' } });
    await page.request.post('/api/todos', { headers, data: { project_id: value.id, title: '继续处理', description: '下一步\n验证结果' } });
    await page.request.post('/api/todos', { headers, data: { project_id: value.id, title: '已交付事项', description: '完成证据', completed: true } });
    await page.goto('/#project/' + value.id);
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    const full = await page.evaluate(() => navigator.clipboard.readText());
    expect(full).toContain('[x] 已交付事项');
    expect((await downloadText(page, '下载项目上下文')).text).toBe(full);
    await choose(page, 'Todo 完成状态', '未完成');
    await page.getByLabel('搜索 Todo', { exact: true }).fill('无匹配搜索');
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    const filtered = await page.evaluate(() => navigator.clipboard.readText());
    for (const text of [value.name, value.id, value.description, 'https://example.com/spec', '[ ] 继续处理', '下一步']) expect(filtered).toContain(text);
    expect(filtered).not.toContain('已交付事项');
    const file = await downloadText(page, '下载项目上下文');
    expect(file.text).toBe(filtered);
    expect(file.name).toMatch(/\.md$/);
    expect(file.name).not.toMatch(/[/:\\<>"|?*]/);
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    await expect(page.getByLabel('项目上下文手动复制')).toHaveValue(filtered);
    await choose(page, 'Todo 完成状态', '已完成');
    await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
    await expect(page.getByLabel('项目上下文手动复制')).toContainText('[x] 已交付事项');
    expect(await page.getByLabel('项目上下文手动复制').inputValue()).not.toContain('[ ] 继续处理');
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('button', { name: '下载项目上下文', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect((await (await page.request.get('/api/projects/' + value.id + '/context')).json()).todos).toHaveLength(2);
});

test('Todo search combines description and status, sorting has stable ties, and controls reset per project', async ({ page }) => {
    const headers = await login(page), value = await project(page, headers), other = await project(page, headers);
    const rows = [
        { id: 'b', title: 'Beta', description: '目标关键词', completed: false, updated_at: '2026-10-31T01:00:00Z' },
        { id: 'a', title: 'Alpha', description: '', completed: true, updated_at: '2026-10-31T02:00:00Z' },
        { id: 'd', title: 'Beta', description: '', completed: false, updated_at: '2026-10-31T01:00:00Z' },
    ];
    await page.route('**/api/projects/' + value.id + '/context', route => route.fulfill({ json: { project: value, links: [], todos: rows } }));
    await page.goto('/#project/' + value.id);
    await expect(page.locator('.todo-body strong')).toHaveText(['Alpha', 'Beta', 'Beta']);
    await choose(page, 'Todo 排序', '标题 A–Z');
    await expect(page.locator('.todo-body strong')).toHaveText(['Alpha', 'Beta', 'Beta']);
    expect(await page.locator('.todo-list > li').evaluateAll(items => items.map(item => item.getAttribute('data-todo-id')))).toEqual(['a', 'b', 'd']);
    await page.getByLabel('搜索 Todo', { exact: true }).fill('关键词');
    await expect(page.locator('.todo-body strong')).toHaveText(['Beta']);
    await choose(page, 'Todo 完成状态', '已完成');
    await expect(page.getByText('没有匹配的 Todo。', { exact: true })).toBeVisible();
    await page.evaluate(id => { location.hash = 'project/' + id; }, other.id);
    await expect(page.getByLabel('搜索 Todo', { exact: true })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Todo 完成状态' })).toContainText('全部');
    await expect(page.getByRole('combobox', { name: 'Todo 排序' })).toContainText('最近更新');
});

test('Agent detail URL survives reload and history, exports literal text and reports missing IDs', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const content = '<script>window.__ran=true</script>\r\n中文指令\n尾行\n';
    const agent = await (await page.request.post('/api/agents', { headers, data: { name: '模板 / 安全:' + randomUUID(), content } })).json();
    await page.goto('/#agents');
    await page.getByRole('button', { name: agent.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('#agent/' + agent.id + '$'));
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Agent 模板详情' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const file = await downloadText(page, '下载 Agent 正文');
    expect(file.text).toBe(content);
    expect(file.name).toMatch(/\.md$/);
    await page.getByRole('button', { name: '复制 Agent 链接', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: '复制 Agent 链接', exact: true }).click();
    await expect(page.getByLabel('Agent 链接手动复制')).toHaveValue(page.url());
    expect(file.name).not.toMatch(/[/:\\<>"|?*]/);
    expect(await page.evaluate(() => (window as { __ran?: boolean }).__ran)).toBeUndefined();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page).toHaveURL(/#agents$/);
    await page.goBack();
    await expect(page.getByRole('dialog', { name: 'Agent 模板详情' })).toBeVisible();
    await page.goto('/#agent/' + randomUUID());
    await expect(page.getByRole('alert')).toContainText('资源不存在或已删除');
    await expect(page.getByRole('dialog', { name: 'Agent 模板详情' })).toHaveCount(0);
});

test('empty Agent body disables copy and download', async ({ page }) => {
    const headers = await login(page);
    const agent = await (await page.request.post('/api/agents', { headers, data: { name: '空模板-' + randomUUID(), content: '' } })).json();
    await page.goto('/#agent/' + agent.id);
    await expect(page.getByRole('button', { name: '下载 Agent 正文', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '复制 Agent 正文', exact: true })).toBeDisabled();
});

for (const width of [320, 390]) test(`Skill current file copy clears stale feedback and offers exact fallback at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const skill = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/single', on_conflict: 'rename' } })).json();
    expect(skill.skill?.id).toBeTruthy();
    const stored = await (await page.request.get('/api/skills/' + skill.skill.id)).json();
    await page.goto('/#skill/' + skill.skill.id);
    await page.getByRole('tab', { name: /文件/ }).click();
    await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(stored.content);
    await expect(page.getByRole('status')).toContainText('SKILL.md');
    await page.getByRole('button', { name: 'scripts/demo.html', exact: true }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
    const file = stored.files.find((entry: { path: string }) => entry.path === 'scripts/demo.html');
    await expect(page.getByLabel('当前文件手动复制')).toHaveValue(file.content);
    await expect(page.getByRole('alert')).toContainText('scripts/demo.html');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.request.delete('/api/skills/' + skill.skill.id, { headers });
});

test('Skill files with the same basename copy the selected full path and literal content', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const headers = await login(page);
    const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/single', on_conflict: 'rename' } })).json();
    const id = imported.skill.id;
    const files = [
        { path: 'references/shared.md', content: '参考目录\n<script>window.__sameNameExecuted=true</script>' },
        { path: 'scripts/shared.md', content: '脚本目录仅文本\n不同文件的完成结果' },
    ];
    try {
        for (const file of files) expect((await page.request.put('/api/skills/' + id + '/files', { headers, data: file })).ok()).toBe(true);
        await page.goto('/#skill/' + id);
        await page.getByRole('tab', { name: /文件/ }).click();
        for (const file of [...files, files[0]]) {
            await page.getByRole('button', { name: file.path, exact: true }).click();
            await expect(page.getByRole('status')).toHaveCount(0);
            await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(file.content);
            await expect(page.getByRole('status')).toContainText(file.path);
        }
        expect(await page.evaluate(() => (window as { __sameNameExecuted?: boolean }).__sameNameExecuted)).toBeUndefined();
    } finally { await page.request.delete('/api/skills/' + id, { headers }); }
});

for (const kind of ['项目', 'Todo', '链接', 'Agent 模板']) test(`${kind} drafts prompt only after real edits and preserve cancelled or failed saves`, async ({ page }) => {
    const headers = await login(page), value = await project(page, headers);
    if (kind === 'Agent 模板') await page.goto('/#agents');
    if (kind === 'Todo' || kind === '链接') await page.goto('/#project/' + value.id);
    const open = kind === 'Todo' ? '添加 Todo' : kind === '链接' ? '添加链接' : '新建' + (kind === 'Agent 模板' ? ' Agent 模板' : kind);
    await page.getByRole('button', { name: open, exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.getByRole('button', { name: open, exact: true }).click();
    const field = page.getByLabel(kind === 'Todo' || kind === '链接' ? '标题' : '名称', { exact: true });
    await field.fill('未保存内容');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('未保存');
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('[data-slot="alert-dialog-content"]')).toHaveCount(0);
    await expect(field).toHaveValue('未保存内容');
    await field.fill('');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
    await page.getByRole('button', { name: open, exact: true }).click();
    await page.getByLabel(kind === 'Todo' || kind === '链接' ? '标题' : '名称', { exact: true }).fill('要放弃');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
});

test('dirty form protects hash navigation and reload, and a failed save keeps the draft', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('保留草稿');
    await page.evaluate(() => { location.hash = 'agents'; });
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('[data-slot="alert-dialog-content"]')).toHaveCount(0);
    await expect(page.getByLabel('名称', { exact: true })).toHaveValue('保留草稿');
    const reload = page.waitForEvent('dialog').then(async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); });
    await page.evaluate(() => location.reload());
    await reload;
    await expect(page.getByLabel('名称', { exact: true })).toHaveValue('保留草稿');
    await page.route('**/api/projects', route => route.fulfill({ status: 503, json: { error: '保存失败夹具' } }));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('保存失败夹具');
    await expect(page.getByLabel('名称', { exact: true })).toHaveValue('保留草稿');
    await page.evaluate(() => { location.hash = 'agents'; });
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Agent 模板', exact: true })).toBeVisible();
});


test('category-only changes and restored existing fields use the same draft guard, successful save clears it', async ({ page }) => {
    const headers = await login(page), value = await project(page, headers);
    await page.goto('/#project/' + value.id);
    await page.getByRole('button', { name: '添加链接', exact: true }).click();
    await choose(page, '类别', 'GitHub');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('[data-slot="alert-dialog-content"]')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '类别', exact: true })).toContainText('GitHub');
    await choose(page, '类别', '其他');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
    await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '编辑项目', exact: true }).click();
    const field = page.getByLabel('名称', { exact: true });
    await field.fill('临时修改');
    await field.fill(value.name);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
    await page.getByRole('button', { name: '添加 Todo', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('成功保存-' + value.id);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText('成功保存-' + value.id, { exact: true })).toBeVisible();
    let unload = false;
    page.on('dialog', async dialog => { unload = true; await dialog.dismiss(); });
    await page.reload();
    await expect(page.getByRole('button', { name: '添加 Todo', exact: true })).toBeVisible();
    expect(unload).toBe(false);
});
