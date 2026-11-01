import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function fixture(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    const headers = { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': (await (await page.request.get('/api/me')).json()).csrf };
    const project = await (await page.request.post('/api/projects', { headers, data: { name: '卡片验收-' + randomUUID() } })).json();
    const description = '<script>window.__todoExecuted=true</script>\n下一步：中文上下文\n' + '执行结果与交接依据。'.repeat(300);
    const todo = await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: 'TODO-003 长任务-' + randomUUID(), description } })).json();
    return { headers, project, todo, description, list: '/#project/' + project.id, detail: '/#project/' + project.id + '/todo/' + todo.id };
}

for (const width of [1280, 390, 320]) test(`Todo cards and full detail support keyboard, reload, return and literal text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    try {
        await page.goto(f.list);
        const card = page.locator('[data-todo-id="' + f.todo.id + '"]');
        await expect(card).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(card).not.toContainText(f.description);
        const link = card.getByRole('link', { name: f.todo.title, exact: true });
        await link.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp('/todo/' + f.todo.id + '$'));
        await expect(page.getByRole('heading', { name: f.todo.title, exact: true })).toBeFocused();
        await expect(page.getByTestId('todo-description')).toHaveText(f.description);
        expect(await page.evaluate(() => (window as { __todoExecuted?: boolean }).__todoExecuted)).toBeUndefined();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.reload();
        await expect(page.getByTestId('todo-description')).toHaveText(f.description);
        await page.getByRole('button', { name: '返回 Todo 列表', exact: true }).click();
        await expect(card).toBeVisible();
        await link.click();
        await page.goBack();
        await expect(card).toBeVisible();
        await page.goForward();
        await expect(page.getByTestId('todo-description')).toHaveText(f.description);
    } finally { await page.request.delete('/api/projects/' + f.project.id, { headers: f.headers }); }
});

test('Todo card actions stay on list and detail edits, completion, deletion and missing IDs are usable', async ({ page }) => {
    const f = await fixture(page);
    try {
        await page.goto(f.list);
        const card = page.locator('[data-todo-id="' + f.todo.id + '"]');
        await card.getByRole('checkbox').click();
        await expect(card.getByRole('checkbox')).toBeChecked();
        await expect(page).toHaveURL(new RegExp('#project/' + f.project.id + '$'));
        await card.getByRole('button', { name: '编辑 / 记录结果', exact: true }).click();
        await page.getByRole('dialog', { name: '编辑条目' }).getByRole('button', { name: '取消', exact: true }).click();
        await expect(page).toHaveURL(new RegExp('#project/' + f.project.id + '$'));
        // Click the card's padding, outside its nested controls.
        await card.click({ position: { x: 8, y: 8 } });
        await expect(page.getByRole('heading', { name: f.todo.title, exact: true })).toBeVisible();
        await page.getByRole('button', { name: '编辑 / 记录结果', exact: true }).click();
        await page.getByLabel('完成结果', { exact: true }).fill('实际执行结果\n保留原ID');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByTestId('todo-description')).toHaveText('实际执行结果\n保留原ID');
        await page.getByRole('checkbox', { name: f.todo.title, exact: true }).click();
        await expect(page.getByRole('checkbox', { name: f.todo.title, exact: true })).not.toBeChecked();
        await page.getByRole('button', { name: '删除 Todo', exact: true }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '删除Todo', exact: true }).click();
        await expect(page.getByText('Todo 不存在或已删除。', { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByText('Todo 不存在或已删除。', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '返回 Todo 列表', exact: true }).click();
        await expect(page.getByRole('button', { name: '添加 Todo', exact: true })).toBeVisible();
        await page.goto(f.list + '/todo/' + randomUUID());
        await expect(page.getByText('Todo 不存在或已删除。', { exact: true })).toBeVisible();
        const other = await (await page.request.post('/api/projects', { headers: f.headers, data: { name: '其他项目-' + randomUUID() } })).json();
        try {
            const foreign = await (await page.request.post('/api/todos', { headers: f.headers, data: { project_id: other.id, title: '其他项目任务' } })).json();
            await page.goto(f.list + '/todo/' + foreign.id);
            await expect(page.getByText('Todo 不存在或已删除。', { exact: true })).toBeVisible();
            await expect(page.getByRole('heading', { name: '其他项目任务' })).toHaveCount(0);
        } finally { await page.request.delete('/api/projects/' + other.id, { headers: f.headers }); }
    } finally { await page.request.delete('/api/projects/' + f.project.id, { headers: f.headers }); }
});

test('56 Todo cards search full hidden descriptions and preserve filters and sort after detail return', async ({ page }) => {
    const f = await fixture(page);
    try {
        for (let i = 1; i < 56; i++) await page.request.post('/api/todos', { headers: f.headers, data: { project_id: f.project.id, title: `规模任务 ${String(i).padStart(2, '0')}`, description: i === 41 ? '唯一匹配接续证据' : '其他说明', completed: i % 2 === 0 } });
        await page.goto(f.list);
        await expect(page.locator('.todo-list > li')).toHaveCount(56);
        await page.getByLabel('搜索 Todo', { exact: true }).fill('唯一匹配接续证据');
        await page.getByRole('combobox', { name: 'Todo 完成状态', exact: true }).click();
        await page.getByRole('option', { name: '未完成', exact: true }).click();
        await page.getByRole('combobox', { name: 'Todo 排序', exact: true }).click();
        await page.getByRole('option', { name: '标题 A–Z', exact: true }).click();
        await expect(page.locator('.todo-list > li')).toHaveCount(1);
        await page.getByRole('link', { name: '规模任务 41', exact: true }).click();
        await expect(page.getByTestId('todo-description')).toHaveText('唯一匹配接续证据');
        await page.getByRole('button', { name: '返回 Todo 列表', exact: true }).click();
        await expect(page.getByLabel('搜索 Todo', { exact: true })).toHaveValue('唯一匹配接续证据');
        await expect(page.getByRole('combobox', { name: 'Todo 完成状态', exact: true })).toContainText('未完成');
        await expect(page.getByRole('combobox', { name: 'Todo 排序', exact: true })).toContainText('标题 A–Z');
        await expect(page.locator('.todo-list > li')).toHaveCount(1);
    } finally { await page.request.delete('/api/projects/' + f.project.id, { headers: f.headers }); }
});
