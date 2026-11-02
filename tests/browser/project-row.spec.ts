import { test, expect } from '@playwright/test';

for (const theme of ['japan-blues', 'cyberpunk']) {
    test(`${theme} project whole row navigates while icon actions stay independent`, async ({ page }) => {
        await page.addInitScript(value => localStorage.setItem('xteam-theme', value), theme);
        await page.goto('/');
        await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
        await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
        const session = await (await page.request.get('/api/me')).json();
        const headers = { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
        const name = `整行-${theme}-长名称与简介对齐验收项目`;
        const response = await page.request.post('/api/projects', { headers, data: { name, description: '简介区域和留白都可打开项目。' } });
        expect(response.status()).toBe(201);
        const project = await response.json();
        try {
            await page.reload();
            const row = page.locator('.resource-row').filter({ hasText: name });
            const link = row.getByRole('link', { name: `进入项目 ${name}`, exact: true });
            await expect(link).toHaveAttribute('href', `#project/${project.id}`);
            await expect(row.getByRole('button', { name, exact: true })).toHaveCount(0);
            await expect(row.locator('.card-name')).toHaveText(name);
            for (const width of [1280, 390, 320]) {
                await page.setViewportSize({ width, height: 900 });
                const title = (await row.locator('.card-name').boundingBox())!;
                const description = (await row.locator('.card-description').boundingBox())!;
                expect(title.x).toBeCloseTo(description.x, 1);
                const box = (await row.boundingBox())!;
                const target = (await link.boundingBox())!;
                expect(Math.abs(target.width - box.width)).toBeLessThanOrEqual(1);
                expect(Math.abs(target.height - box.height)).toBeLessThanOrEqual(1);
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
                for (const label of [`编辑项目 ${name}`, `打开项目 ${name}`]) {
                    const button = row.getByRole('button', { name: label, exact: true });
                    await expect(button).toHaveAttribute('title', label);
                    await expect(button).toHaveText('');
                    const size = (await button.boundingBox())!;
                    expect(size.width).toBeCloseTo(size.height, 1);
                }
                await row.getByRole('button', { name: `编辑项目 ${name}`, exact: true }).click();
                await expect(page.getByRole('dialog')).toBeVisible();
                expect(new URL(page.url()).hash).not.toContain('#project/');
                await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
            }
            await page.setViewportSize({ width: 1280, height: 900 });
            for (const selector of ['.card-name', '.card-description', '.resource-time', null]) {
                const area = (await (selector ? row.locator(selector) : row).boundingBox())!;
                await page.mouse.click(area.x + 2, area.y + 2);
                await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
                await expect(page).toHaveURL(new RegExp(`#project/${project.id}$`));
                await page.getByRole('button', { name: '← 所有项目', exact: true }).click();
            }
            await row.getByRole('button', { name: `编辑项目 ${name}`, exact: true }).focus();
            await page.keyboard.press('Shift+Tab');
            await expect(link).toBeFocused();
            expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
            await page.keyboard.press('Enter');
            await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
            await page.getByRole('button', { name: '← 所有项目', exact: true }).click();
            await row.getByRole('button', { name: `打开项目 ${name}`, exact: true }).click();
            await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        } finally { await page.request.delete(`/api/projects/${project.id}`, { headers }); }
    });
}
