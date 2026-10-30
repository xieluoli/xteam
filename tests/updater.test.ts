import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createUpdater } from '../scripts/updater.js';

const currentSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);

test('native Node host service accepts only fixed Unix-socket actions and refuses a second daemon', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xt-host-'));
    const socket = join(directory, 'u.sock');
    const environment: NodeJS.ProcessEnv = { ...process.env, XTEAM_UPDATER_DIRECTORY: directory, XTEAM_UPDATER_SOURCE: join(directory, 'source'), XTEAM_UPDATER_SOCKET: socket };
    delete environment.XTEAM_UPDATER_GROUP;
    const script = fileURLToPath(new URL('../scripts/updater.ts', import.meta.url));
    const child = spawn(process.execPath, [script], { env: environment, stdio: 'ignore' });
    const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
    async function call(path: string, body?: string): Promise<{ status: number; body: any }> {
        return new Promise((resolve, reject) => {
            const call = request({ socketPath: socket, path, method: body === undefined ? 'GET' : 'POST' }, response => {
                let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(text) }));
            }); call.on('error', reject); call.end(body);
        });
    }
    try {
        let view;
        for (let count = 0; count < 50; count++) { try { view = await call('/status'); if (view.status === 200) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
        assert.equal(view?.body.phase, 'idle');
        assert.equal((await call('/check', '{"command":"bad"}')).status, 400);
        assert.equal((await call('/exec', '{}')).status, 404);
        assert.equal((await call('/upgrade', JSON.stringify({ releaseId: 42, sha: nextSha }))).status, 409);
        const second = spawn(process.execPath, [script], { env: environment, stdio: 'ignore' });
        assert.equal(await new Promise(resolve => second.once('exit', resolve)), 1);
        assert.equal((await call('/status')).body.phase, 'idle');
    } finally { child.kill('SIGTERM'); await exited; await rm(directory, { recursive: true, force: true }); }
});

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'xt-updater-'));
    await mkdir(join(directory, 'source'));
    const calls: { program: string; args: string[] }[] = [];
    const container = { Id: 'old-container-id', Config: { Image: 'xteam:old', Env: ['XTEAM_VERSION=' + currentSha, 'XTEAM_DATABASE=/data/xteam.db', 'XTEAM_ORIGIN=https://xteam.example'], User: 'node', Labels: {} }, HostConfig: { NetworkMode: 'bridge', RestartPolicy: { Name: 'unless-stopped' }, PortBindings: { '3100/tcp': [{ HostIp: '127.0.0.1', HostPort: '13100' }] }, Binds: [directory + '/data:/data', directory + '/socket:/run/xteam-update:ro'] }, NetworkSettings: { Networks: { bridge: { Aliases: null }, xteam_default: { Aliases: ['xteam-rewrite', 'xteam-service'] } } } };
    const state = { draft: false, prerelease: false, ci: 'success', authFails: false, noRelease: false, onMain: true, previousRelease: false, healthFails: false, buildFails: false, latestId: 42, newContainer: false };
    async function run(program: string, args: string[]) {
        calls.push({ program, args });
        if (program === 'gh') {
            if (args[0] === 'auth') { if (state.authFails) throw new Error('not logged in'); return ''; }
            if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'xieluoli/xteam' });
            if (state.noRelease) throw Object.assign(new Error('not found'), { stderr: 'gh: Not Found (HTTP 404)' });
            if (args[0] === 'api') return JSON.stringify({ id: state.latestId, tag_name: 'v2.0.0', name: 'XTEAM 2', published_at: '2026-10-30T00:00:00Z', draft: state.draft, prerelease: state.prerelease });
            return JSON.stringify([{ headSha: nextSha, status: 'completed', conclusion: state.ci }]);
        }
        if (program === 'git') {
            if (args.includes('archive')) await writeFile(args.find(value => value.startsWith('--output='))!.slice(9), 'archive');
            if (args.includes('get-url')) return 'https://github.com/xieluoli/xteam.git\n';
            if (args.includes('rev-parse')) return nextSha + '\n';
            if (args.includes('merge-base')) {
                const first = args.at(-2), second = args.at(-1);
                if (second === 'refs/remotes/origin/main' && !state.onMain) throw Object.assign(new Error('not on main'), { code: 1 });
                if ((first === nextSha && second === currentSha && !state.previousRelease) || (first === currentSha && second === nextSha && state.previousRelease)) throw Object.assign(new Error('not ancestor'), { code: 1 });
            }
            return '';
        }
        if (program === 'docker') {
            if (args[0] === 'inspect') {
                if (args.at(-1) === 'xteam-rewrite' && state.newContainer) return JSON.stringify([{ ...container, Id: 'new-container-id', Config: { ...container.Config, Labels: { 'io.xteam.upgrade.id': calls.find(call => call.args[0] === 'create')!.args.find(value => value.startsWith('io.xteam.upgrade.id='))!.split('=')[1] } } }]);
                return JSON.stringify([container]);
            }
            if (args[0] === 'build' && state.buildFails) throw new Error('build failed');
            if (args[0] === 'cp') await writeFile(args.at(-1)!, 'verified-backup');
            if (args[0] === 'create') state.newContainer = true;
            if (args[0] === 'rename' && args[1].startsWith('xteam-rewrite-before-')) state.newContainer = false;
        }
        return '';
    }
    const updater = await createUpdater({ directory, source: join(directory, 'source'), container: 'xteam-rewrite', healthUrl: 'https://xteam.example/health', run, health: async () => { if (state.healthFails && state.newContainer) throw new Error('health failed'); return state.newContainer ? nextSha : currentSha; } });
    return { updater, directory, calls, state, run, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('updater requires a published release on main with successful CI, and never downgrades', async () => {
    const context = await fixture();
    try {
        context.state.authFails = true;
        assert.match((await context.updater.check()).message, /未登录或认证失效/);
        assert.equal(context.calls.filter(call => call.program === 'gh' && call.args[0] === 'api').length, 0);
        context.state.authFails = false;
        context.state.noRelease = true;
        assert.equal((await context.updater.check()).message, '暂无可用的正式 Release');
        assert.equal(context.calls.some(call => call.program === 'git'), false);
        context.state.noRelease = false;
        context.state.draft = true;
        assert.equal((await context.updater.check()).phase, 'failed');
        context.state.draft = false;
        context.state.prerelease = true;
        assert.equal((await context.updater.check()).phase, 'failed');
        context.state.prerelease = false;
        context.state.onMain = false;
        assert.equal((await context.updater.check()).phase, 'failed');
        context.state.onMain = true;
        context.state.ci = 'failure';
        assert.equal((await context.updater.check()).phase, 'failed');
        context.state.ci = 'success';
        context.state.previousRelease = true;
        const older = await context.updater.check();
        assert.equal(older.available, false);
        assert.equal(context.calls.some(call => call.args[0] === 'stop'), false);
    } finally { await context.cleanup(); }
});

test('interrupted switching restores the recorded old container; unknown container identity stops recovery', async () => {
    const context = await fixture();
    const transaction = { id: 'interrupted', oldId: 'old-container-id', oldName: 'xteam-rewrite-before-interrupted', previousSha: currentSha, targetSha: nextSha, restart: 'unless-stopped' };
    try {
        await writeFile(join(context.directory, 'transaction.json'), JSON.stringify(transaction));
        const restored = await createUpdater({ directory: context.directory, source: join(context.directory, 'source'), container: 'xteam-rewrite', healthUrl: 'https://xteam.example/health', run: context.run, health: async () => currentSha });
        assert.equal(restored.status().phase, 'rolled_back');
        assert(context.calls.some(call => call.args[0] === 'update' && call.args[1] === '--restart=unless-stopped'));
        await writeFile(join(context.directory, 'transaction.json'), JSON.stringify({ ...transaction, oldId: 'different-container' }));
        const count = context.calls.length;
        const refused = await createUpdater({ directory: context.directory, source: join(context.directory, 'source'), container: 'xteam-rewrite', healthUrl: 'https://xteam.example/health', run: context.run, health: async () => currentSha });
        assert.equal(refused.status().phase, 'failed');
        assert.throws(() => refused.check(), /需管理员恢复/);
        assert.equal(context.calls.slice(count).some(call => ['stop', 'start', 'rename'].includes(call.args[0])), false);
    } finally { await context.cleanup(); }
});

test('upgrade pins approval, rejects concurrency and preserves ports, mounts and both networks', async () => {
    const context = await fixture();
    try {
        const checking = context.updater.check();
        assert.throws(() => context.updater.check(), /正在/);
        await checking;
        assert.throws(() => context.updater.upgrade({ releaseId: 1, sha: nextSha }), /重新检查/);
        const result = await context.updater.upgrade({ releaseId: 42, sha: nextSha });
        assert.equal(result.phase, 'succeeded');
        const created = context.calls.find(call => call.args[0] === 'create')!.args;
        assert(created.includes('127.0.0.1:13100:3100/tcp'));
        assert(created.includes(context.directory + '/data:/data'));
        assert(created.includes(context.directory + '/socket:/run/xteam-update:ro'));
        assert(context.calls.some(call => call.args.includes('connect') && call.args.includes('xteam_default') && call.args.includes('xteam-service')));
        assert(context.calls.some(call => call.args[0] === 'exec' && call.args.join(' ').includes('integrity_check')));
        assert.equal(context.calls.some(call => call.args[0] === 'rm'), false);
        assert(context.calls.some(call => call.args[0] === 'update' && call.args[1] === '--restart=no'));
    } finally { await context.cleanup(); }
});

test('build failure leaves the current container running; health failure rolls back only the application', async () => {
    const context = await fixture();
    try {
        await context.updater.check();
        context.state.buildFails = true;
        assert.equal((await context.updater.upgrade({ releaseId: 42, sha: nextSha })).phase, 'failed');
        assert.equal(context.calls.some(call => call.args[0] === 'stop'), false);
        context.state.buildFails = false;
        await context.updater.check();
        context.state.healthFails = true;
        const result = await context.updater.upgrade({ releaseId: 42, sha: nextSha });
        assert.equal(result.phase, 'rolled_back');
        assert(context.calls.some(call => call.args[0] === 'rename' && call.args[1].startsWith('xteam-rewrite-before-')));
        assert.equal(context.calls.some(call => call.args.join(' ').includes('volume rm') || call.args[0] === 'rm'), false);
        const restarted = await createUpdater({ directory: context.directory, source: join(context.directory, 'source'), container: 'xteam-rewrite', healthUrl: 'https://xteam.example/health', run: async () => '' });
        assert.equal(restarted.status().phase, 'rolled_back');
    } finally { await context.cleanup(); }
});

test('release changes between check and confirmation are rejected before any deployment', async () => {
    const context = await fixture();
    try {
        await context.updater.check();
        context.state.latestId++;
        assert.equal((await context.updater.upgrade({ releaseId: 42, sha: nextSha })).phase, 'failed');
        assert.equal(context.calls.some(call => call.args[0] === 'build'), false);
    } finally { await context.cleanup(); }
});
