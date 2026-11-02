import { test, expect } from '@playwright/test';

test('project rows sort, keep search state, and refresh failures keep readable context', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    const session = await (await page.request.get('/api/me')).json();
    const headers = { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
    for (const name of ['布局-B', '布局-A']) {
        const response = await page.request.post('/api/projects', { headers, data: { name, description: '名称与简介在同一列。' } });
        expect(response.status()).toBe(201);
    }
    await page.getByRole('textbox', { name: '按名称查找' }).fill('布局-');
    await page.getByRole('combobox', { name: '项目排序' }).click();
    await page.getByRole('option', { name: '名称 A–Z' }).click();
    await expect(page.locator('.resource-row .card-name')).toHaveText(['布局-A', '布局-B']);
    await expect(page.getByRole('textbox', { name: '按名称查找' })).toHaveValue('布局-');
    await page.getByRole('link', { name: '进入项目 布局-A', exact: true }).click();
    await expect(page.getByLabel('当前位置')).toContainText('布局-A');
    await expect(page.getByTestId('last-refreshed')).toBeVisible();
    const timestamp = await page.getByTestId('last-refreshed').textContent();
    await page.route('**/api/projects/*/context', route => route.fulfill({ status: 503, json: { error: '刷新暂不可用' } }));
    await page.getByRole('button', { name: '刷新项目', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('刷新暂不可用');
    await expect(page.getByRole('heading', { name: '布局-A', exact: true })).toBeVisible();
    await expect(page.getByTestId('last-refreshed')).toHaveText(timestamp!);
    await page.getByRole('button', { name: '更多项目操作' }).click();
    await page.getByRole('menuitem', { name: '编辑项目' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '← 所有项目', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '项目排序' })).toContainText('名称 A–Z');
});
