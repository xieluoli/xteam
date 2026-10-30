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

test('a late project refresh cannot overwrite a newer saved Todo state', async ({ page }) => {
    const headers = await login(page);
    const project = await (await page.request.post('/api/projects', { headers, data: { name: `刷新顺序-${randomUUID()}` } })).json();
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '保存后的状态' } });
    await page.goto(`/#project/${project.id}`);
    const checkbox = page.getByRole('checkbox', { name: '保存后的状态', exact: true });
    await expect(checkbox).not.toBeChecked();
    let releaseResponse = () => {};
    let captureResponse = () => {};
    const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
    const capturedResponse = new Promise<void>(resolve => { captureResponse = resolve; });
    let holdNextResponse = true;
    await page.route(`**/api/projects/${project.id}/context`, async route => {
        if (!holdNextResponse) { await route.continue(); return; }
        holdNextResponse = false;
        const response = await route.fetch();
        captureResponse();
        await heldResponse;
        await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '刷新项目', exact: true }).click();
    await capturedResponse;
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    releaseResponse();
    await expect(page.getByRole('button', { name: '刷新项目', exact: true })).toBeEnabled();
    await expect(checkbox).toBeChecked();
});

test('skip to content preserves the Skill route and unsaved draft', async ({ page }) => {
    const headers = await login(page);
    const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/components', on_conflict: 'rename' } })).json();
    const route = `#skill/${imported.skill.id}`;
    await page.goto('/' + route);
    await page.getByLabel('名称', { exact: true }).fill('未保存的 Skill 草稿');
    const skipLink = page.getByRole('link', { name: '跳到主要内容', exact: true });
    await skipLink.focus();
    await skipLink.press('Enter');
    await expect(page).toHaveURL(new RegExp(route + '$'));
    await expect(page.getByLabel('名称', { exact: true })).toHaveValue('未保存的 Skill 草稿');
    await expect(page.locator('#main-content')).toBeFocused();
    expect((await page.request.delete('/api/skills/' + imported.skill.id, { headers })).ok()).toBe(true);
});

test('a save finishing after navigation cannot invalidate the destination list', async ({ page }) => {
    const headers = await login(page);
    const name = `导航读取-${randomUUID()}`;
    const project = await (await page.request.post('/api/projects', { headers, data: { name: name + '-项目' } })).json();
    const todo = await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: name } })).json();
    await page.request.post('/api/agents', { headers, data: { name: name + '-模板', content: '团队模板' } });
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeVisible();
    let releaseSave = () => {};
    let releaseList = () => {};
    const heldSave = new Promise<void>(resolve => { releaseSave = resolve; });
    const heldList = new Promise<void>(resolve => { releaseList = resolve; });
    await page.route(`**/api/todos/${todo.id}`, async route => {
        const response = await route.fetch();
        await heldSave;
        await route.fulfill({ response });
    });
    await page.route('**/api/agents?*', async route => {
        const response = await route.fetch();
        await heldList;
        await route.fulfill({ response });
    });
    await page.getByRole('checkbox', { name, exact: true }).click();
    await page.getByRole('link', { name: 'Agent 模板', exact: true }).click();
    await page.getByRole('button', { name: '新建 Agent 模板', exact: true }).click();
    const saveButton = page.getByRole('dialog').getByRole('button', { name: '保存', exact: true });
    await expect(saveButton).toBeEnabled();
    releaseSave();
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    releaseList();
    await expect(page.getByRole('button', { name: name + '-模板', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: name + '-项目', exact: true })).toHaveCount(0);
});
