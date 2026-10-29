import { test, expect } from '@playwright/test';

test('Skill read failure offers retry and an empty result has no misleading table header', async ({ page }) => {
    await page.route('**/api/skills', route => route.fulfill({ status: 503, json: { error: 'Skill 暂不可用' } }));
    await page.goto('/#skills');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Skill 暂不可用');
    await page.route('**/api/skills', route => route.fulfill({ json: [] }));
    await page.getByRole('button', { name: '重试读取 Skill' }).click();
    await expect(page.getByRole('heading', { name: '从 URL 导入第一个 Skill' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
});
