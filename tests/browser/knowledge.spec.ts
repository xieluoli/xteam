import { test, expect } from '@playwright/test';

async function login(page: any) {
    await page.goto('/');
    await page.getByLabel('邮箱', { exact: true }).fill('browser@example.com');
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '组织知识', exact: true })).toBeVisible();
}

test('Wiki homepage supports SOP → local Skill → Agent binding → portable workflow', async ({ page }) => {
    await login(page);
    const suffix = Date.now();
    await page.getByRole('button', { name: '新建空间', exact: true }).click();
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('组织方法-' + suffix);
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '新建页面', exact: true }).click();
    await page.getByRole('dialog').getByLabel('页面标题').fill('需求评审 SOP');
    await page.getByRole('combobox', { name: '页面类型' }).click();
    await page.getByRole('option', { name: 'SOP', exact: true }).click();
    await page.getByRole('dialog').getByLabel('初始正文').fill('# 评审步骤\n\n先核对来源，再确认验收条件。');
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: '需求评审 SOP', exact: true })).toBeVisible();
    await page.getByLabel('上传资料原件').setInputFiles({ name: '研究.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') });
    await expect(page.getByRole('link', { name: '研究.pdf', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '保存为 Skill', exact: true }).click();
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('review-' + suffix);
    await page.getByRole('dialog').getByLabel('适用场景').fill('需求评审前使用');
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存 Skill');
    await page.getByRole('button', { name: '新建 Agent', exact: true }).click();
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('产品经理-' + suffix);
    await page.getByRole('dialog').getByLabel('Agent 指令').fill('遵守团队评审方法');
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '绑定 Skill', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已绑定选定 Skill 版本');
    await page.getByRole('link', { name: '工作流程', exact: true }).click();
    await page.getByRole('button', { name: '新建工作流程', exact: true }).click();
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('需求到交付-' + suffix);
    await page.getByRole('button', { name: '添加步骤', exact: true }).click();
    await page.getByRole('dialog').getByLabel('步骤 1', { exact: true }).fill('评审');
    await page.getByRole('combobox', { name: '步骤 Skill 1', exact: true }).click();
    await page.getByRole('option', { name: 'review-' + suffix, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: '需求到交付-' + suffix, exact: true })).toBeVisible();
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出流程', exact: true }).click();
    expect((await saved).suggestedFilename()).toMatch(/^workflow-/);
    await page.screenshot({ path: '.local/wiki-workflow-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '.local/wiki-workflow-mobile.png', fullPage: true });
});

test('Wiki editing preserves drafts on conflict and cancelled navigation, supports search and archive restore', async ({ page }) => {
    await login(page);
    const data = await page.evaluate(async () => {
        const me = await (await fetch('/api/me')).json();
        const post = async (path: string, body: unknown) => (await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify(body) })).json();
        const s = await post('/wiki/spaces', { name: '并发知识' });
        const p = await post('/wiki/pages', { space_id: s.id, title: '猫狗项圈调研', content: '初始背景' });
        return p;
    });
    await page.goto('/#page/' + data.id);
    await page.getByRole('button', { name: '编辑页面', exact: true }).click();
    await page.getByLabel('页面正文', { exact: true }).fill('本地新增调研');
    await page.evaluate(async (id: string) => { const me = await (await fetch('/api/me')).json(); await fetch('/api/wiki/pages/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify({ expected_version: 1, content: '另一设备内容' }) }); }, data.id);
    await page.getByRole('button', { name: '保存页面', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('版本冲突');
    await expect(page.getByLabel('页面正文', { exact: true })).toHaveValue('本地新增调研');
    await page.getByRole('link', { name: '组织知识', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('页面正文', { exact: true })).toHaveValue('本地新增调研');
    await page.getByRole('button', { name: '读取最新版本', exact: true }).click();
    await expect(page.getByText('另一设备内容', { exact: true })).toBeVisible();
    await page.getByLabel('页面正文', { exact: true }).fill('另一设备内容\n本地新增调研');
    await page.getByRole('button', { name: '我已合并，使用最新版本号', exact: true }).click();
    await page.getByRole('button', { name: '保存页面', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('页面已保存');
    await page.getByLabel('搜索组织知识').fill('本地新增调研');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByRole('region', { name: '搜索结果' })).toContainText('猫狗项圈调研');
    await page.getByRole('button', { name: '清除', exact: true }).click();
    await page.getByRole('button', { name: '归档页面', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '归档页面', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已归档');
    await page.getByRole('button', { name: '恢复页面', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '恢复页面', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.screenshot({ path: '.local/wiki-page-desktop.png', fullPage: true });
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true).catch(async e => { console.log(JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: Array.from(document.querySelectorAll('*')).map(el => ({ tag: el.tagName, className: el.getAttribute('class'), text: el.textContent?.slice(0,50), right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(el => el.right > innerWidth + 1 && el.width > 0).slice(0,30) })))); throw e; }); await page.screenshot({ path: `.local/wiki-page-${width}.png`, fullPage: true }); }
});

test('A Wiki save finishing after navigation cannot replace the destination page', async ({ page }) => {
    await login(page);
    const data = await page.evaluate(async () => {
        const me = await (await fetch('/api/me')).json();
        const post = async (path: string, body: unknown) => (await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify(body) })).json();
        const s = await post('/wiki/spaces', { name: '异步接续' });
        return { first: await post('/wiki/pages', { space_id: s.id, title: '正在保存的页面', content: '原内容' }), second: await post('/wiki/pages', { space_id: s.id, title: '目标页面', content: '目标内容' }) };
    });
    await page.goto('/#page/' + data.first.id);
    await page.getByRole('button', { name: '编辑页面', exact: true }).click();
    await page.getByLabel('页面正文', { exact: true }).fill('等待保存的内容');
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/wiki/pages/' + data.first.id, async route => { if (route.request().method() === 'PATCH') await gate; await route.continue(); });
    const started = page.waitForRequest(request => request.url().endsWith('/wiki/pages/' + data.first.id) && request.method() === 'PATCH');
    await page.getByRole('button', { name: '保存页面', exact: true }).click();
    await started;
    await page.evaluate(id => { location.hash = 'page/' + id; }, data.second.id);
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('heading', { name: '目标页面', exact: true })).toBeVisible();
    const finished = page.waitForResponse(response => response.url().endsWith('/wiki/pages/' + data.first.id) && response.request().method() === 'PATCH');
    release(); await finished;
    await expect(page.getByRole('heading', { name: '目标页面', exact: true })).toBeVisible();
    await expect(page.getByText('目标内容', { exact: true })).toBeVisible();
});
