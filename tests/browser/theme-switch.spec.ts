import { test, expect } from '@playwright/test';

test('theme switches immediately, survives reload and preserves login input', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'japan-blues');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByRole('combobox', { name: '界面主题' }).click();
    await page.getByRole('option', { name: 'cyberpunk', exact: true }).click();
    await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('browser@example.com');
    await expect(page.locator('html')).toHaveCSS('background-color', 'oklch(0.1418 0.0662 295.805)');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCSS('border-radius', '0px');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyberpunk');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('名称', { exact: true }).fill('主题草稿');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCSS('background-color', 'oklch(0.1418 0.0662 295.805)');
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: '界面主题' }).click();
    await page.getByRole('option', { name: 'Japan Blues', exact: true }).click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await expect(dialog).toHaveCSS('background-color', 'oklch(0.9818 0.0054 95.0986)');
});

test('unknown and unavailable browser storage fall back to Japan Blues before startup', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('xteam-theme', 'unknown'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'japan-blues');
    await page.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
        Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'japan-blues');
    await page.getByRole('combobox', { name: '界面主题' }).click();
    await page.getByRole('option', { name: 'cyberpunk', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyberpunk');
});
