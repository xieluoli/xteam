import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const theme of ['Japan Blues', 'cyberpunk']) test(`${theme} login fits narrow screens`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: '界面主题' }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    for (const width of [390, 375, 320]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const email = (await page.getByLabel('邮箱', { exact: true }).boundingBox())!;
        expect(email.x).toBeGreaterThanOrEqual(0);
        expect(email.x + email.width).toBeLessThanOrEqual(width);
        await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    }
});

for (const theme of ['Japan Blues', 'cyberpunk']) test(`${theme} preserves project state and has usable mobile controls and portals`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: '界面主题' }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    const session = await (await page.request.get('/api/me')).json();
    const headers = { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
    const name = `主题响应式-${randomUUID()}`;
    const project = await (await page.request.post('/api/projects', { headers, data: { name, description: '很长的项目背景。'.repeat(25) } })).json();
    await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '验证手机操作', description: '多行结果\n'.repeat(6) } });
    await page.goto(`/#project/${project.id}`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    for (const width of [1280, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const more = page.getByRole('button', { name: '更多项目操作' });
        expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await more.click();
        const menu = page.getByRole('menu');
        await expect(menu).toHaveCSS('background-color', theme === 'cyberpunk' ? 'oklch(0.1418 0.0662 295.805)' : 'oklch(1 0 0)');
        await page.getByRole('menuitem', { name: '删除项目' }).click();
        const confirm = page.getByRole('alertdialog');
        await expect(confirm).toContainText(name);
        await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeFocused();
        await confirm.getByRole('button', { name: '取消', exact: true }).click();
        if (width === 390) {
            const todo = (await page.getByRole('region', { name: 'Todo', exact: true }).boundingBox())!;
            const resources = (await page.getByRole('complementary', { name: '项目资料' }).boundingBox())!;
            expect(todo.y).toBeLessThan(resources.y);
        }
        await page.screenshot({ path: `.local/design-${theme}-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '切换侧边栏', exact: true }).click();
    await page.getByRole('link', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.topbar').getByRole('combobox', { name: '界面主题' })).toHaveCount(0);
    const nextTheme = theme === 'Japan Blues' ? 'cyberpunk' : 'Japan Blues';
    await page.getByRole('combobox', { name: '界面主题' }).click();
    await page.getByRole('option', { name: nextTheme, exact: true }).click();
    const expectedTheme = nextTheme === 'cyberpunk' ? 'cyberpunk' : 'japan-blues';
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    await page.reload();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const settings = page.getByRole('region', { name: '设置', exact: true });
        await settings.scrollIntoViewIfNeeded();
        const settingsBox = (await settings.boundingBox())!;
        const headingBox = (await settings.getByRole('heading', { name: '设置', exact: true }).boundingBox())!;
        const labelBox = (await settings.getByText('主题', { exact: true }).boundingBox())!;
        const selector = (await page.getByRole('combobox', { name: '界面主题' }).boundingBox())!;
        expect(settingsBox.width).toBeLessThanOrEqual(720);
        expect(settingsBox.x).toBeGreaterThanOrEqual(16);
        expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(width - 16);
        expect(labelBox.x).toBeCloseTo(headingBox.x, 0);
        expect(labelBox.x + labelBox.width).toBeLessThan(selector.x);
        expect(selector.x + selector.width).toBeCloseTo(settingsBox.x + settingsBox.width, 0);
        expect(selector.height).toBeGreaterThanOrEqual(44);
        expect((await settings.locator('.theme-choice').boundingBox())!.height).toBeGreaterThanOrEqual(64);
        await page.screenshot({ path: `.local/settings-${expectedTheme}-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '切换侧边栏', exact: true }).click();
    await page.getByRole('link', { name: '项目', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeFocused();
});
