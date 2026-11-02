import { test, expect } from '@playwright/test';

test('sidebar update entry checks Release, confirms a pinned upgrade and recovers status after reload', async ({ page }) => {
    const sha = 'b'.repeat(40);
    let version = 'a'.repeat(40);
    let state = { phase: 'idle', message: '尚未检查更新', available: false, release: { id: 42, tag: 'v2.0.0', sha }, requestId: 'operation' };
    const upgrades: unknown[] = [];
    let checks = 0;
    await page.route(/\/api\/updates(?:\/.*)?$/, async route => {
        if (route.request().url().endsWith('/check')) { checks++; state = { ...state, phase: 'ready', available: version !== state.release.sha, message: version === state.release.sha ? '已是最新正式版本' : '发现正式版本 ' + state.release.tag }; await route.fulfill({ status: 202, json: { ...state, phase: 'checking' } }); }
        else if (route.request().url().endsWith('/upgrade')) { upgrades.push(route.request().postDataJSON()); version = sha; state = { ...state, phase: 'succeeded', available: false, message: '已升级到 v2.0.0，公网版本校验通过' }; await route.fulfill({ status: 202, json: { ...state, phase: 'upgrading' } }); }
        else await route.fulfill({ json: { enabled: true, canUpgrade: true, currentVersion: version, state } });
    });
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '检查系统更新', exact: true }).click();
    const updates = page.getByRole('region', { name: '系统更新', exact: true });
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeFocused();
    await expect(updates.getByRole('button', { name: '升级到 v2.0.0', exact: true })).toBeEnabled();
    expect(checks).toBe(1);
    await updates.getByRole('button', { name: '升级到 v2.0.0', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('短暂中断');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(updates.getByRole('button', { name: '升级到 v2.0.0', exact: true })).toBeEnabled();
    expect(upgrades).toEqual([]);
    await page.screenshot({ path: '.local/updates-desktop.png', fullPage: true, animations: 'disabled' });
    await updates.getByRole('button', { name: '升级到 v2.0.0', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认升级', exact: true }).click();
    await expect(updates.getByRole('status')).toContainText('公网版本校验通过');
    expect(upgrades).toEqual([{ releaseId: 42, sha }]);
    await page.reload();
    await expect(updates.getByRole('status')).toContainText('已升级到 v2.0.0');
    await expect(updates.getByTestId('current-version')).toHaveAttribute('title', sha);
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.getByRole('button', { name: '切换侧边栏' }).click();
        await page.getByRole('button', { name: '检查系统更新', exact: true }).click();
        await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeFocused();
        await expect(page.getByRole('dialog', { name: '团队导航' })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(updates.getByRole('button', { name: '检查更新', exact: true })).toBeEnabled();
        await page.getByRole('combobox', { name: '界面主题' }).click();
        await page.getByRole('option', { name: width === 390 ? 'cyberpunk' : 'Japan Blues', exact: true }).click();
        await expect(page.getByRole('listbox')).toHaveCount(0);
        for (const button of await updates.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeCloseTo((width === 390 ? 4 : 3.52) * 9, 1);
        await page.screenshot({ path: '.local/updates-' + width + '.png', fullPage: true, animations: 'disabled' });
    }
});

test('non-operator sees version but no upgrade action; updater errors offer status recovery', async ({ page }) => {
    let operator = false, offline = false;
    let writes = 0;
    await page.route(/\/api\/updates(?:\/.*)?$/, async route => {
        if (route.request().method() === 'POST') writes++;
        if (offline) await route.fulfill({ status: 503, json: { error: '升级服务暂不可用' } });
        else await route.fulfill({ json: { enabled: true, canUpgrade: operator, currentVersion: 'a'.repeat(40), state: { phase: 'idle', message: '尚未检查更新' } } });
    });
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '检查系统更新', exact: true }).click();
    const updates = page.getByRole('region', { name: '系统更新', exact: true });
    await expect(updates).toContainText('仅部署管理员可检查和升级');
    await expect(updates.getByRole('button', { name: '检查更新', exact: true })).toHaveCount(0);
    expect(writes).toBe(0);
    operator = true; offline = true;
    await updates.getByRole('button', { name: '刷新状态', exact: true }).click();
    await expect(updates.getByRole('alert')).toContainText('升级服务暂不可用');
    offline = false;
    await updates.getByRole('button', { name: '刷新状态', exact: true }).click();
    await expect(updates.getByRole('alert')).toHaveCount(0);
    await expect(updates.getByRole('button', { name: '检查更新', exact: true })).toBeVisible();
});
