import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function height(control: Locator, expected: number) {
    await expect.poll(async () => (await control.boundingBox())?.height).toBeCloseTo(expected, 1);
}

for (const theme of ['japan-blues', 'cyberpunk']) {
    const spacing = theme === 'japan-blues' ? 3.52 : 4;
    test(`${theme} retains official control sizes and button hierarchy`, async ({ page }) => {
        await page.addInitScript(value => localStorage.setItem('xteam-theme', value), theme);
        await page.goto('/');
        expect(await page.locator('html').evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
        await height(page.getByRole('button', { name: '登录', exact: true }), spacing * 9);
        await height(page.getByLabel('邮箱', { exact: true }), spacing * 9);
        await height(page.getByRole('combobox', { name: '界面主题' }), spacing * 9);
        await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
        await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
        const session = await (await page.request.get('/api/me')).json();
        const headers = { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
        const name = `设计比例-${randomUUID()}-${'长名称'.repeat(15)}`;
        const response = await page.request.post('/api/projects', { headers, data: { name } });
        expect(response.ok()).toBeTruthy();
        await page.reload();
        expect(await page.locator('.content').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeCloseTo(spacing * 8, 1);
        const title = page.getByRole('button', { name, exact: true });
        for (const width of [1280, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            expect(await title.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        const create = page.getByRole('button', { name: '新建项目', exact: true });
        await height(create, spacing * 9);
        await height(page.getByRole('button', { name: `编辑项目 ${name}`, exact: true }), spacing * 8);
        await create.click();
        const dialog = page.getByRole('dialog');
        const close = dialog.getByRole('button', { name: '关闭', exact: true });
        await height(close, spacing * 9);
        expect((await close.boundingBox())!.width).toBeCloseTo(spacing * 9, 1);
        await expect(dialog.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('data-variant', 'default');
        await expect(dialog.getByRole('button', { name: '取消', exact: true })).toHaveAttribute('data-variant', 'outline');
        await expect(close).toHaveAttribute('data-variant', 'ghost');
        const primary = dialog.getByRole('button', { name: '保存', exact: true });
        const secondary = dialog.getByRole('button', { name: '取消', exact: true });
        expect(await primary.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await secondary.evaluate(el => getComputedStyle(el).backgroundColor));
        await page.screenshot({ path: `.local/ds21-${theme}-dialog-1280.png`, fullPage: true });
    });

    test(`${theme} Tabs stay within their list across desktop and narrow screens`, async ({ page }) => {
        await page.addInitScript(value => localStorage.setItem('xteam-theme', value), theme);
        await page.goto('/#skills');
        await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
        await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.getByRole('button', { name: '从 URL 导入', exact: true })).toBeVisible();
        const session = await (await page.request.get('/api/me')).json();
        const headers = { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
        const response = await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/components', on_conflict: 'rename' } });
        expect(response.ok()).toBeTruthy();
        const imported = await response.json();
        try {
            await page.goto(`/#skill/${imported.skill.id}`);
            for (const width of [1280, 390, 320]) {
                await page.setViewportSize({ width, height: 900 });
                const list = page.getByRole('tablist');
                await height(list, spacing * 9);
                const box = (await list.boundingBox())!;
                for (const tab of await page.getByRole('tab').all()) {
                    const item = (await tab.boundingBox())!;
                    expect(item.y).toBeGreaterThanOrEqual(box.y);
                    expect(item.y + item.height).toBeLessThanOrEqual(box.y + box.height);
                    expect(item.height).toBeGreaterThanOrEqual(24);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
                await page.getByRole('tab', { name: '概览', exact: true }).focus();
                await page.keyboard.press('ArrowRight');
                await expect(page.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
                const heading = page.locator('.skill-preview h1');
                await expect(heading).toBeVisible();
                expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(await page.locator('.skill-preview p').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)));
                await page.screenshot({ path: `.local/ds21-${theme}-files-${width}.png`, fullPage: true });
                await page.keyboard.press('ArrowLeft');
                await expect(page.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute('aria-selected', 'true');
                await page.screenshot({ path: `.local/ds21-${theme}-tabs-${width}.png`, fullPage: true });
            }
        } finally { await page.request.delete('/api/skills/' + imported.skill.id, { headers }); }
    });
}
