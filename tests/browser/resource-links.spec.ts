import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function login(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    return { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': (await (await page.request.get('/api/me')).json()).csrf };
}

for (const [theme, width] of [['japan-blues', 390], ['cyberpunk', 320]] as const) test(`Skill file deep links survive reload and history and protect drafts (${theme})`, async ({ page }) => {
    const headers = await login(page);
    const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/single', on_conflict: 'rename' } })).json();
    const id = imported.skill.id;
    const files = [{ path: 'references/中文 空格.md', content: '# 参考文件' }, { path: 'scripts/中文 空格.md', content: '# 脚本文件' }];
    try {
        for (const file of files) expect((await page.request.put('/api/skills/' + id + '/files', { headers, data: file })).ok()).toBe(true);
        await page.goto('/#skill/' + id);
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.setItem('xteam-theme', theme); }, theme);
        await page.setViewportSize({ width, height: 844 });
        await page.getByRole('tab', { name: /文件/ }).click();
        for (const file of files) {
            await page.getByRole('button', { name: file.path, exact: true }).click();
            await expect(page).toHaveURL(new RegExp('file='));
            expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('file')).toBe(file.path);
            await expect(page.getByTestId('current-skill-file')).toHaveText('当前文件：' + file.path);
        }
        const shared = page.url();
        await page.reload();
        await expect(page.getByRole('heading', { name: '脚本文件', exact: true })).toBeVisible();
        await page.goBack();
        await expect(page.getByRole('heading', { name: '参考文件', exact: true })).toBeVisible();
        await page.goForward();
        await expect(page.getByRole('heading', { name: '脚本文件', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '编辑文件', exact: true }).click();
        await page.getByLabel('文件正文', { exact: true }).fill('尚未保存的草稿');
        await page.goBack();
        await expect(page.getByRole('alertdialog')).toContainText('未保存');
        await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
        await expect(page).toHaveURL(shared);
        await expect(page.getByLabel('文件正文', { exact: true })).toHaveValue('尚未保存的草稿');
        await page.getByRole('button', { name: files[0].path, exact: true }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click();
        await expect(page.getByRole('heading', { name: '参考文件', exact: true })).toBeVisible();
        await page.goto('/#skill/' + id + '?file=' + encodeURIComponent('references/missing.md'));
        await expect(page.getByTestId('current-skill-file')).toHaveText('当前文件：SKILL.md');
        await expect(page.getByRole('alert')).toContainText('文件不存在');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await page.request.delete('/api/skills/' + id, { headers }); }
});

for (const [theme, width] of [['japan-blues', 390], ['cyberpunk', 320]] as const) test(`Todo links copy the exact identity and discard stale clipboard feedback (${theme})`, async ({ page, context }) => {
    const headers = await login(page);
    const project = await (await page.request.post('/api/projects', { headers, data: { name: '链接验收-' + randomUUID() } })).json();
    try {
        const todos = [];
        for (const description of ['同名任务甲', '同名任务乙']) todos.push(await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '同名 Todo', description } })).json());
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/#project/' + project.id + '/todo/' + todos[0].id);
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.setItem('xteam-theme', theme); }, theme);
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('button', { name: '复制 Todo 链接', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '复制 Todo 链接', exact: true }).click();
        await expect(page.getByTestId('todo-link-feedback')).toHaveText('Todo 链接已复制');
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toBe('http://127.0.0.1:3199/#project/' + project.id + '/todo/' + todos[0].id);
        await page.goto(copied);
        await expect(page.locator('.todo-detail .prewrap')).toHaveText('同名任务甲');
        await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
        await page.getByRole('button', { name: '复制 Todo 链接', exact: true }).click();
        await expect(page.getByLabel('Todo 链接手动复制', { exact: true })).toHaveValue(copied);
        await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise((_, reject) => { (window as any).rejectTodoCopy = reject; }); });
        await page.getByRole('button', { name: '复制 Todo 链接', exact: true }).click();
        await page.evaluate(hash => { location.hash = hash; }, '#project/' + project.id + '/todo/' + todos[1].id);
        await expect(page.locator('.todo-detail .prewrap')).toHaveText('同名任务乙');
        await page.evaluate(() => (window as any).rejectTodoCopy(new Error('late denial')));
        await expect(page.getByTestId('todo-link-feedback')).toHaveCount(0);
        await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
        await page.getByRole('button', { name: '复制 Todo 链接', exact: true }).click();
        await expect(page.getByLabel('Todo 链接手动复制', { exact: true })).toHaveValue('http://127.0.0.1:3199/#project/' + project.id + '/todo/' + todos[1].id);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await page.request.delete('/api/projects/' + project.id, { headers }); }
});

for (const [theme, width] of [['japan-blues', 390], ['cyberpunk', 320]] as const) test(`Todo clear filters restores list and export scope while keeping sort (${theme})`, async ({ page, context }) => {
    const headers = await login(page);
    const project = await (await page.request.post('/api/projects', { headers, data: { name: '筛选验收-' + randomUUID() } })).json();
    try {
        const todos = [];
        for (const item of [{ title: 'Alpha 未完成', completed: false }, { title: 'Zulu 已完成', completed: true }]) todos.push(await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, ...item } })).json());
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/#project/' + project.id);
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.setItem('xteam-theme', theme); }, theme);
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('button', { name: '清除 Todo 筛选', exact: true })).toHaveCount(0);
        await page.getByRole('combobox', { name: 'Todo 排序', exact: true }).click();
        await page.getByRole('option', { name: '标题 A–Z', exact: true }).click();
        await page.getByRole('combobox', { name: 'Todo 完成状态', exact: true }).click();
        await page.getByRole('option', { name: '已完成', exact: true }).click();
        await page.getByLabel('搜索 Todo', { exact: true }).fill('不存在');
        await expect(page.locator('.todo-list li')).toHaveCount(0);
        await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
        const filtered = await page.evaluate(() => navigator.clipboard.readText());
        expect(filtered).toContain(todos[1].id);
        expect(filtered).not.toContain(todos[0].id);
        await expect(page.getByRole('button', { name: '清除 Todo 筛选', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '清除 Todo 筛选', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel('搜索 Todo', { exact: true })).toHaveValue('');
        await expect(page.getByRole('combobox', { name: 'Todo 完成状态', exact: true })).toContainText('全部');
        await expect(page.getByRole('combobox', { name: 'Todo 排序', exact: true })).toContainText('标题 A–Z');
        await expect(page.locator('.todo-list li')).toHaveCount(2);
        await expect(page.locator('.todo-list li').first()).toHaveAttribute('data-todo-id', todos[0].id);
        await expect(page.getByTestId('context-feedback')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '清除 Todo 筛选', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '复制项目上下文', exact: true }).click();
        const all = await page.evaluate(() => navigator.clipboard.readText());
        for (const todo of todos) expect(all).toContain(todo.id);
        await page.getByLabel('搜索 Todo', { exact: true }).fill('Alpha');
        await expect(page.locator('.todo-list li')).toHaveCount(1);
        await page.getByRole('button', { name: '清除 Todo 筛选', exact: true }).click();
        await expect(page.locator('.todo-list li')).toHaveCount(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await page.request.delete('/api/projects/' + project.id, { headers }); }
});
