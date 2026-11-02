import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    const session = await (await page.request.get('/api/me')).json();
    return { Origin: 'http://127.0.0.1:3199', 'X-CSRF-Token': session.csrf };
}

for (const theme of ['japan-blues', 'cyberpunk']) {
    test(`${theme} resource navigation and page focus use text semantics`, async ({ page }) => {
        await page.addInitScript(value => localStorage.setItem('xteam-theme', value), theme);
        const headers = await login(page);
        const project = await (await page.request.post('/api/projects', { headers, data: { name: `按钮语义项目-${theme}`, description: '设计系统回归' } })).json();
        const agent = await (await page.request.post('/api/agents', { headers, data: { name: `按钮语义模板-${theme}`, content: '仅文本' } })).json();
        try {
            await page.getByRole('link', { name: 'Agent 模板', exact: true }).click();
            const name = page.getByRole('link', { name: agent.name, exact: true });
            await expect(name).toHaveAttribute('href', '#agent/' + agent.id);
            await expect(name).not.toHaveAttribute('data-slot', 'button');
            await name.focus();
            await page.keyboard.press('Enter');
            await expect(page.getByRole('dialog', { name: 'Agent 模板详情', exact: true })).toBeVisible();
            await page.getByRole('button', { name: '关闭', exact: true }).click();
            await page.getByRole('link', { name: '项目', exact: true }).click();
            await page.getByRole('link', { name: `进入项目 ${project.name}`, exact: true }).click();
            const heading = page.getByRole('heading', { name: project.name, exact: true });
            await expect(heading).toBeFocused();
            expect(await heading.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
            const back = page.getByRole('link', { name: '← 所有项目', exact: true });
            await expect(back).toHaveAttribute('href', '#projects');
            await page.keyboard.press('Tab');
            await back.focus();
            expect(await back.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
            await page.keyboard.press('Enter');
            await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
        } finally {
            await page.request.delete('/api/projects/' + project.id, { headers });
            await page.request.delete('/api/agents/' + agent.id, { headers });
        }
    });

    test(`${theme} text actions retain explicit button surfaces and form behavior`, async ({ page }) => {
        await page.addInitScript(value => localStorage.setItem('xteam-theme', value), theme);
        const headers = await login(page);
        const project = await (await page.request.post('/api/projects', { headers, data: { name: '动作层级项目' } })).json();
        const todo = await (await page.request.post('/api/todos', { headers, data: { project_id: project.id, title: '层级Todo', completed: false } })).json();
        await page.request.post('/api/links', { headers, data: { project_id: project.id, title: '层级链接', url: 'https://example.com', category: 'other' } });
        const imported = await (await page.request.post('/api/skills/import', { headers, data: { url: 'https://github.com/example/components', on_conflict: 'rename' } })).json();
        const assertSurfaces = async () => {
            const textGhosts = await page.locator('#main-content button[data-variant="ghost"]').evaluateAll(elements => elements.filter(el => el.textContent?.trim() && !el.closest('aside[aria-label="文件目录"]')).map(el => el.textContent?.trim()));
            expect(textGhosts).toEqual([]);
        };
        try {
            await page.goto('/#project/' + project.id);
            await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
            await assertSurfaces();
            await page.getByRole('link', { name: todo.title, exact: true }).click();
            await expect(page.getByRole('link', { name: '返回 Todo 列表', exact: true })).toHaveAttribute('href', '#project/' + project.id);
            await expect(page.getByRole('button', { name: '复制 Todo 上下文', exact: true })).toHaveAttribute('data-variant', 'default');
            await assertSurfaces();
            await page.goto('/#skill/' + imported.skill.id);
            await expect(page.getByRole('button', { name: '保存属性', exact: true })).toBeVisible();
            await assertSurfaces();
            await expect(page.getByRole('button', { name: '保存属性', exact: true })).toHaveAttribute('type', 'submit');
            await expect(page.getByRole('button', { name: '从来源更新', exact: true })).toHaveAttribute('type', 'button');
            await page.getByRole('tab', { name: /文件/ }).click();
            await assertSurfaces();
            await page.goto('/#settings');
            await expect(page.getByRole('button', { name: '刷新状态', exact: true })).toHaveAttribute('data-variant', 'outline');
        } finally {
            await page.request.delete('/api/skills/' + imported.skill.id, { headers });
            await page.request.delete('/api/projects/' + project.id, { headers });
        }
    });
}
