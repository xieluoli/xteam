import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function prompt(question: string, secret: boolean) {
    if (!process.stdin.isTTY) throw new Error('请在交互终端输入密码；不要把密码写入命令参数');
    if (!secret) {
        const reader = createInterface({ input: process.stdin, output: process.stdout });
        try { return await reader.question(question); } finally { reader.close(); }
    }
    process.stdout.write(question);
    const terminal = process.stdin, previousRaw = terminal.isRaw;
    terminal.setRawMode(true); terminal.resume(); terminal.setEncoding('utf8');
    return new Promise<string>((resolve, reject) => {
        let value = '';
        function cleanup() { terminal.off('data', listener); terminal.setRawMode(previousRaw); terminal.pause(); process.stdout.write('\n'); }
        function listener(chunk: string) { for (const character of chunk) {
            if (character === '\u0003' || character === '\u0004') { cleanup(); reject(new Error('已取消')); return; }
            if (character === '\r' || character === '\n') { cleanup(); resolve(value); return; }
            if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
            else value += character;
        } }
        terminal.on('data', listener);
    });
}

export async function runUpgradeCli(args: string[], ask = prompt, output: (value: string) => void = value => process.stdout.write(value)) {
    const [action, ...flags] = args;
    if (!['status', 'check', 'upgrade'].includes(action)) throw new Error('用法：node scripts/upgrade.ts status|check|upgrade --url https://你的域名 --email 管理员邮箱 [--yes]');
    let address = '', email = '', confirmed = false;
    for (let index = 0; index < flags.length; index++) {
        const flag = flags[index];
        if (flag === '--yes') confirmed = true;
        else if (flag === '--url' && flags[index + 1]) address = flags[++index];
        else if (flag === '--email' && flags[index + 1]) email = flags[++index];
        else throw new Error('未知或缺少值的参数：' + flag);
    }
    if (!address || !email) throw new Error('请指定 --url 与 --email');
    const url = new URL(address);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('升级地址必须为 HTTPS 域名；本机测试允许 HTTP 回环地址');
    let cookie = '', csrf = '';
    async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
        let response;
        try { response = await fetch(url.origin + '/api' + path, { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Origin: url.origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
        catch { throw Object.assign(new Error('服务连接暂不可用'), { retryable: true }); }
        const value = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(value.error ?? '服务请求失败'), { retryable: [502, 503, 504].includes(response.status) });
        if (path === '/login') { cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''; csrf = value.csrf; if (!cookie || !csrf) throw new Error('登录响应缺少会话，已停止'); }
        return value;
    }
    async function wait(requestId: string) {
        const deadline = Date.now() + 45 * 60 * 1000;
        let unavailableSince = 0, lastMessage = '';
        while (Date.now() < deadline) {
            let value;
            try { value = await api('/updates'); unavailableSince = 0; }
            catch (error) { if (!(error as { retryable?: boolean }).retryable) throw error; unavailableSince ||= Date.now(); if (Date.now() - unavailableSince > 120000) throw new Error('升级结果暂不可达，请稍后使用 status 查询；不要重复发起升级'); }
            if (value) {
                if (value.state.requestId !== requestId) throw new Error('更新任务已变化，请使用 status 核对结果');
                if (value.state.message !== lastMessage) { output(value.state.message + '\n'); lastMessage = value.state.message; }
                if (!['checking', 'upgrading'].includes(value.state.phase)) return value.state;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error('等待超时，请使用 status 查询；不要重复发起升级');
    }
    try {
        await api('/login', 'POST', { email, password: await ask('密码（输入不可见）: ', true) });
        const view = await api('/updates');
        output('当前版本：' + view.currentVersion + '\n');
        if (action === 'status') { output(view.state.message + '\n'); return ['failed', 'rolled_back'].includes(view.state.phase) ? 2 : 0; }
        if (!view.enabled || !view.canUpgrade) throw new Error('此实例未启用升级服务，或当前账号未获部署升级权限');
        const checking = await api('/updates/check', 'POST', {});
        const checked = await wait(checking.requestId);
        if (checked.phase === 'failed') return 2;
        if (action === 'check' || !checked.available) return 0;
        output('目标 Release：' + checked.release.tag + '\n提交：' + checked.release.sha + '\n');
        if (!confirmed && await ask('升级会短暂中断服务。输入 upgrade 继续: ', false) !== 'upgrade') { output('已取消\n'); return 1; }
        const upgrading = await api('/updates/upgrade', 'POST', { releaseId: checked.release.id, sha: checked.release.sha });
        const result = await wait(upgrading.requestId);
        return result.phase === 'succeeded' ? 0 : 2;
    } finally { if (cookie) await api('/logout', 'POST', {}).catch(() => {}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runUpgradeCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write((error as Error).message + '\n'); process.exitCode = 1; });
