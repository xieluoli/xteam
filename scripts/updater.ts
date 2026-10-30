import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { chmod, chown, mkdir, mkdtemp, readFile, rename, rm, writeFile, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'xieluoli/xteam';
const execute = promisify(execFile);
type Release = { id: number; tag: string; name: string; sha: string; publishedAt: string };
type State = { phase: 'idle' | 'checking' | 'ready' | 'upgrading' | 'succeeded' | 'failed' | 'rolled_back'; message: string; updatedAt: string; release?: Release; available?: boolean; requestId?: string };
type Transaction = { id: string; oldId: string; oldName: string; previousSha: string; targetSha: string; restart?: string };
type Options = { directory: string; source: string; container: string; healthUrl: string; run?: (program: string, args: string[]) => Promise<string>; health?: () => Promise<string> };
function fault(message: string, status = 400) { return Object.assign(new Error(message), { status }); }
async function jsonFile(file: string) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function save(file: string, value: unknown) {
    const temporary = file + '.' + randomUUID();
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
}

export async function createUpdater(options: Options) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(options.container)) throw fault('容器名称无效');
    const healthUrl = new URL(options.healthUrl);
    if (!['http:', 'https:'].includes(healthUrl.protocol) || healthUrl.username || healthUrl.password) throw fault('健康检查地址无效');
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const run = options.run ?? (async (program, args) => (await execute(program, args, { timeout: program === 'docker' && args[0] === 'build' ? 1800000 : 60000, maxBuffer: 8 * 1024 * 1024 })).stdout);
    const git = (...args: string[]) => run('git', ['-C', options.source, ...args]);
    const docker = (...args: string[]) => run('docker', args);
    const stateFile = join(options.directory, 'status.json');
    const transactionFile = join(options.directory, 'transaction.json');
    let state: State = await jsonFile(stateFile) ?? { phase: 'idle', message: '尚未检查更新', updatedAt: new Date().toISOString() };
    let busy = false;
    let recoveryBlocked = false;
    async function record(phase: State['phase'], message: string, changes: Partial<State> = {}) {
        state = { ...state, ...changes, phase, message, updatedAt: new Date().toISOString() };
        await save(stateFile, state);
        return { ...state };
    }
    async function inspect(name: string): Promise<any> { return JSON.parse(await docker('inspect', name))[0]; }
    async function exists(name: string) { try { return await inspect(name); } catch (error) { if (/No such (object|container)/i.test((error as { stderr?: string }).stderr ?? '')) return null; throw error; } }
    const health = options.health ?? (async () => { const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000), headers: { 'Cache-Control': 'no-cache' }, redirect: 'error' }); if (!response.ok) throw fault('公网健康检查失败'); return (await response.json()).version as string; });
    async function healthy(sha: string) {
        for (let attempt = 0; attempt < (options.health ? 1 : 30); attempt++) {
            try { if (await health() === sha) return; } catch { /* Wait for the container and proxy to become ready. */ }
            if (!options.health) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw fault('公网 /health 版本未匹配目标 SHA');
    }
    async function ancestor(first: string, second: string) {
        try { await git('merge-base', '--is-ancestor', first, second); return true; }
        catch (error) { if ((error as { code?: unknown }).code === 1) return false; throw error; }
    }
    async function latest() {
        try { await run('gh', ['auth', 'status']); }
        catch { throw fault('宿主 gh 未登录或认证失效，请管理员完成官方登录；不要提交令牌到网页'); }
        try { const repo = JSON.parse(await run('gh', ['repo', 'view', repository, '--json', 'nameWithOwner'])); if (repo.nameWithOwner !== repository) throw fault('仓库不匹配'); }
        catch { throw fault('宿主 gh 无法读取固定仓库，请管理员检查仓库权限与网络'); }
        let release;
        try { release = JSON.parse(await run('gh', ['api', 'repos/' + repository + '/releases/latest'])); }
        catch (error) { if (/HTTP 404/.test((error as { stderr?: string }).stderr ?? '')) return null; throw fault('无法读取正式 Release；请检查宿主 gh 认证和网络，不会回退到 main'); }
        if (!Number.isSafeInteger(release.id) || release.id <= 0 || release.draft || release.prerelease || !release.published_at || typeof release.tag_name !== 'string') throw fault('目标不是已发布的正式 Release');
        const tag = release.tag_name;
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(tag)) throw fault('Release tag 无效');
        const origin = (await git('remote', 'get-url', 'origin')).trim();
        if (!['https://github.com/' + repository + '.git', 'git@github.com:' + repository + '.git'].includes(origin)) throw fault('升级源码仓库不匹配');
        await git('check-ref-format', 'refs/tags/' + tag);
        await git('fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main', '--tags');
        const sha = (await git('rev-parse', '--verify', 'refs/tags/' + tag + '^{commit}')).trim();
        if (!/^[a-f0-9]{40}$/.test(sha) || !await ancestor(sha, 'refs/remotes/origin/main')) throw fault('Release 尚未合入 main');
        const runs = JSON.parse(await run('gh', ['run', 'list', '--repo', repository, '--workflow', 'check.yml', '--branch', 'main', '--event', 'push', '--commit', sha, '--limit', '1', '--json', 'headSha,status,conclusion']));
        if (!Array.isArray(runs) || !runs.length || runs[0].headSha !== sha || runs[0].status !== 'completed' || runs[0].conclusion !== 'success') throw fault('Release 提交的 main CI 尚未通过');
        return { id: release.id, tag, sha, name: release.name || tag, publishedAt: release.published_at } as Release;
    }
    async function assess(release: Release, container: any) {
        const current = container.Config.Env.find((value: string) => value.startsWith('XTEAM_VERSION='))?.slice(14);
        if (!/^[a-f0-9]{40}$/.test(current ?? '')) throw fault('当前容器缺少完整 XTEAM_VERSION，需管理员先校准版本');
        if (current === release.sha || await ancestor(release.sha, current)) return { available: false, current, message: current === release.sha ? '已是最新正式版本' : '当前版本已包含此 Release，暂无更新' };
        if (!await ancestor(current, release.sha)) throw fault('Release 与当前版本不在同一升级路径，禁止自动切换');
        return { available: true, current, message: '发现正式版本 ' + release.tag };
    }
    async function rollback(transaction: Transaction) {
        if (!/^[a-f0-9]{40}$/.test(transaction.previousSha) || !transaction.oldName.startsWith(options.container + '-before-') || !transaction.id || !transaction.oldId) throw fault('恢复记录无效，需管理员核对');
        const current = await exists(options.container);
        if (current?.Config.Labels?.['io.xteam.upgrade.id'] === transaction.id) {
            await docker('stop', options.container);
            await docker('rename', options.container, options.container + '-failed-' + transaction.id);
        } else if (current && current.Id !== transaction.oldId) throw fault('容器已被其他操作替换，停止自动回退');
        if (!current || current.Id !== transaction.oldId) {
            const previous = await inspect(transaction.oldName);
            if (previous.Id !== transaction.oldId) throw fault('旧容器身份不匹配，停止自动回退');
            await docker('rename', transaction.oldName, options.container);
        }
        await docker('start', options.container);
        if (transaction.restart) await docker('update', '--restart=' + transaction.restart, options.container);
        await healthy(transaction.previousSha);
        await save(transactionFile, null);
    }
    const interrupted = await jsonFile(transactionFile) as Transaction | null;
    if (interrupted) {
        try { await rollback(interrupted); await record('rolled_back', '升级进程中断，已恢复旧应用；数据未回写旧备份', { available: false }); }
        catch { recoveryBlocked = true; await record('failed', '升级中断且自动回退未完成，请管理员核对保留的容器和恢复记录', { available: false }); }
    } else if (['checking', 'upgrading'].includes(state.phase)) await record('failed', '上次操作中断，请重新检查更新', { available: false });

    function begin(phase: 'checking' | 'upgrading') {
        if (recoveryBlocked) throw fault('上次升级需管理员恢复，停止接受新升级', 409);
        if (busy) throw fault('正在处理更新，请等待结果', 409);
        busy = true;
        state = { ...state, phase, available: false, requestId: randomUUID(), updatedAt: new Date().toISOString(), message: phase === 'checking' ? '正在检查正式 Release…' : '正在升级…' };
    }
    function check() {
        begin('checking');
        return (async () => { try {
            await save(stateFile, state);
            const release = await latest();
            if (!release) return await record('ready', '暂无可用的正式 Release', { release: undefined, available: false });
            const result = await assess(release, await inspect(options.container));
            return await record('ready', result.message, { release, available: result.available });
        } catch (error) { return await record('failed', (error as Error).message, { available: false }); }
        finally { busy = false; } })();
    }
    function upgrade(approval: { releaseId: number; sha: string }) {
        if (busy) throw fault('正在处理更新，请等待结果', 409);
        if (!state.available || !state.release || approval.releaseId !== state.release.id || approval.sha !== state.release.sha) throw fault('目标已变化，请重新检查并确认 Release', 409);
        const approved = { ...state.release };
        begin('upgrading');
        return (async () => {
            let buildDirectory = '';
            let transaction: Transaction | null = null;
            try {
                await save(stateFile, state);
                const release = await latest();
                if (!release || release.id !== approved.id || release.sha !== approved.sha || release.tag !== approved.tag) throw fault('Release 已变化，请重新检查并确认');
                const container = await inspect(options.container);
                const assessment = await assess(release, container);
                if (!assessment.available) throw fault('当前版本无需升级，请重新检查');
                const config = container.Config, host = container.HostConfig;
                const networks: [string, any][] = Object.entries(container.NetworkSettings.Networks);
                const binds: string[] = host.Binds ?? [];
                const databasePath = config.Env.find((value: string) => value.startsWith('XTEAM_DATABASE='))?.slice(15);
                if (!databasePath?.startsWith('/data/') || !binds.some(value => value.split(':')[1] === '/data')) throw fault('仅支持已持久挂载 /data 的现有实例，请管理员核对挂载');
                if (!networks.length || networks.some(([name, endpoint]) => ['host', 'none'].includes(name) || endpoint.IPAMConfig?.IPv4Address || endpoint.IPAMConfig?.IPv6Address) || host.Privileged || host.AutoRemove || host.Devices?.length || host.Links?.length || host.Mounts?.length || Object.keys(host.Tmpfs ?? {}).length) throw fault('存在需要人工保留的容器配置，切换前停止，请管理员核对');
                if (config.Env.some((value: string) => /[\r\n]/.test(value))) throw fault('多行环境变量需管理员迁移，未切换容器');
                const id = randomUUID();
                buildDirectory = await mkdtemp(join(options.directory, 'build-'));
                const archive = join(buildDirectory, 'source.tar');
                await git('archive', '--format=tar', '--output=' + archive, release.sha);
                await run('tar', ['-xf', archive, '-C', buildDirectory]);
                await unlink(archive);
                const image = 'xteam-rewrite:' + release.sha;
                await record('upgrading', '正在构建 ' + release.tag);
                await docker('build', '--tag', image, buildDirectory);
                // The target image must read the existing schema without running migrations.
                const backupPath = '/data/.upgrade-backup-' + id + '.db';
                const backupCode = 'import Database from "better-sqlite3"; import {chmod} from "node:fs/promises"; const db=new Database(process.argv[1]); await db.backup(process.argv[2]); db.close(); const copy=new Database(process.argv[2],{readonly:true}); if(copy.pragma("integrity_check",{simple:true})!=="ok") throw new Error("backup integrity failed"); copy.close(); await chmod(process.argv[2],0o600);';
                await record('upgrading', '正在在线备份并校验 SQLite');
                await docker('exec', options.container, 'node', '--input-type=module', '-e', backupCode, databasePath, backupPath);
                const backups = join(options.directory, 'backups');
                await mkdir(backups, { recursive: true, mode: 0o700 });
                const backup = join(backups, id + '.db');
                await docker('cp', options.container + ':' + backupPath, backup);
                await chmod(backup, 0o600);
                // Read-only schema check runs before stopping the current application.
                await docker('run', '--rm', '--network', 'none', '--user', '0', '--mount', 'type=bind,src=' + backup + ',dst=/backup.db,readonly', '--entrypoint', 'node', image, '--input-type=module', '-e', 'import Database from "better-sqlite3"; const db=new Database("/backup.db",{readonly:true}); if(db.pragma("integrity_check",{simple:true})!=="ok") throw new Error("invalid backup"); for(const table of ["users","projects","todos","links","agents","skills"]) db.prepare("SELECT count(*) FROM "+table).get(); db.close();');
                const envFile = join(buildDirectory, 'runtime.env');
                await writeFile(envFile, config.Env.filter((value: string) => !value.startsWith('XTEAM_VERSION=')).concat('XTEAM_VERSION=' + release.sha).join('\n'), { mode: 0o600, flag: 'wx' });
                const create = ['create', '--name', options.container, '--label', 'io.xteam.upgrade.id=' + id, '--env-file', envFile, '--network', networks[0][0]];
                const restart = host.RestartPolicy;
                if (restart?.Name) create.push('--restart', restart.Name === 'on-failure' && restart.MaximumRetryCount ? 'on-failure:' + restart.MaximumRetryCount : restart.Name);
                for (const bind of binds) create.push('--volume', bind);
                for (const [port, values] of Object.entries(host.PortBindings ?? {})) for (const binding of values as { HostIp: string; HostPort: string }[]) {
                    const ip = binding.HostIp.includes(':') ? '[' + binding.HostIp + ']' : binding.HostIp || '0.0.0.0';
                    create.push('--publish', ip + ':' + binding.HostPort + ':' + port);
                }
                for (const [key, value] of Object.entries(config.Labels ?? {})) if (key !== 'io.xteam.upgrade.id') create.push('--label', key + '=' + value);
                if (config.User) create.push('--user', config.User);
                if (config.WorkingDir) create.push('--workdir', config.WorkingDir);
                if (host.ReadonlyRootfs) create.push('--read-only');
                if (host.Memory) create.push('--memory', String(host.Memory));
                if (host.NanoCpus) create.push('--cpus', String(host.NanoCpus / 1e9));
                if (host.PidsLimit > 0) create.push('--pids-limit', String(host.PidsLimit));
                if (host.ShmSize) create.push('--shm-size', String(host.ShmSize));
                if (host.Init) create.push('--init');
                for (const [key, flag] of [['Dns', '--dns'], ['DnsSearch', '--dns-search'], ['DnsOptions', '--dns-option'], ['ExtraHosts', '--add-host']] as const) for (const value of host[key] ?? []) create.push(flag, value);
                if (host.LogConfig?.Type) create.push('--log-driver', host.LogConfig.Type);
                for (const [key, value] of Object.entries(host.LogConfig?.Config ?? {})) create.push('--log-opt', key + '=' + value);
                for (const [key, flag] of [['CapAdd', '--cap-add'], ['CapDrop', '--cap-drop'], ['SecurityOpt', '--security-opt']] as const) for (const value of host[key] ?? []) create.push(flag, value);
                const aliases = (endpoint: any) => (endpoint.Aliases ?? []).filter((alias: string) => alias !== container.Id && alias !== container.Id.slice(0, 12));
                if (networks[0][0] !== 'bridge') for (const alias of aliases(networks[0][1])) create.push('--network-alias', alias);
                if (config.Entrypoint?.length) create.push('--entrypoint', config.Entrypoint[0]);
                create.push(image, ...(config.Entrypoint?.slice(1) ?? []), ...(config.Cmd ?? []));
                transaction = { id, oldId: container.Id, oldName: options.container + '-before-' + id, previousSha: assessment.current, targetSha: release.sha, restart: restart?.Name === 'on-failure' && restart.MaximumRetryCount ? 'on-failure:' + restart.MaximumRetryCount : restart?.Name };
                if ((await inspect(options.container)).Id !== container.Id) { transaction = null; throw fault('容器在准备期间已被其他操作替换，未切换，请重新检查'); }
                await save(transactionFile, transaction);
                await record('upgrading', '正在切换应用，页面可能短暂断开');
                await docker('stop', options.container);
                await docker('rename', options.container, transaction.oldName);
                await docker('update', '--restart=no', transaction.oldName);
                await docker(...create);
                for (const [network, endpoint] of networks.slice(1)) {
                    const connect = ['network', 'connect'];
                    for (const alias of aliases(endpoint)) connect.push('--alias', alias);
                    await docker(...connect, network, options.container);
                }
                await docker('start', options.container);
                await healthy(release.sha);
                await record('succeeded', '已升级到 ' + release.tag + '，公网版本校验通过', { available: false });
                await save(transactionFile, null);
                return { ...state };
            } catch (error) {
                if (transaction) { try { await rollback(transaction); return await record('rolled_back', '升级失败，已回退旧应用；数据未回写旧备份', { available: false }); }
                    catch { recoveryBlocked = true; return await record('failed', '升级失败且自动回退未完成，请管理员核对保留的容器、备份及恢复记录', { available: false }); } }
                return await record('failed', (error as Error).message, { available: false });
            } finally { if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true }); busy = false; }
        })();
    }
    return { status: () => ({ ...state }), check, upgrade };
}

async function main() {
    const directory = process.env.XTEAM_UPDATER_DIRECTORY ?? '/opt/xteam-updater';
    const socket = process.env.XTEAM_UPDATER_SOCKET ?? '/opt/xteam-rewrite/update/updater.sock';
    // A stale socket may be removed only after confirming that no updater is listening.
    try {
        const info = await lstat(socket);
        if (!info.isSocket()) throw fault('升级 socket 路径已被其他文件占用');
        const active = await new Promise<boolean>(resolve => { const probe = httpRequest({ socketPath: socket, path: '/status', timeout: 2000 }, response => { response.resume(); resolve(true); }); probe.on('error', error => resolve(!['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? ''))); probe.on('timeout', () => { resolve(true); probe.destroy(); }); probe.end(); });
        if (active) throw fault('已有升级服务运行，不能抢占 socket');
        await unlink(socket);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let updater: Awaited<ReturnType<typeof createUpdater>> | undefined;
    await mkdir(resolve(socket, '..'), { recursive: true, mode: 0o750 });
    const server = createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        try {
            if (!updater) throw fault('升级服务正在恢复状态', 503);
            if (request.method === 'GET' && request.url === '/status') { response.end(JSON.stringify(updater.status())); return; }
            if (request.method !== 'POST' || !['/check', '/upgrade'].includes(request.url ?? '')) throw fault('升级动作不存在', 404);
            let body = '';
            for await (const chunk of request) { body += chunk; if (body.length > 1024) throw fault('升级参数过大', 413); }
            const data = JSON.parse(body);
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw fault('升级参数无效');
            if (request.url === '/check' && Object.keys(data).length || request.url === '/upgrade' && (Object.keys(data).sort().join(',') !== 'releaseId,sha' || !Number.isSafeInteger(data.releaseId) || typeof data.sha !== 'string' || !/^[a-f0-9]{40}$/.test(data.sha))) throw fault('升级参数无效');
            const work = request.url === '/check' ? updater.check() : updater.upgrade(data);
            void work.catch(() => { /* The persisted status carries the operation result. */ });
            response.statusCode = 202;
            response.end(JSON.stringify(updater.status()));
        } catch (error) { response.statusCode = (error as { status?: number }).status ?? 400; response.end(JSON.stringify({ error: error instanceof SyntaxError ? '升级参数无效' : (error as Error).message })); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    try {
        await chmod(socket, 0o660);
        if (process.env.XTEAM_UPDATER_GROUP) await chown(socket, process.getuid!(), Number(process.env.XTEAM_UPDATER_GROUP));
        updater = await createUpdater({ directory, source: process.env.XTEAM_UPDATER_SOURCE ?? join(directory, 'source'), container: process.env.XTEAM_UPDATER_CONTAINER ?? 'xteam-rewrite', healthUrl: process.env.XTEAM_UPDATER_HEALTH ?? 'https://xteam.space01.cc/health' });
    } catch (error) { await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
    function stop() { server.close(); }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('升级服务启动失败，请检查宿主配置、权限及恢复记录\n'); process.exitCode = 1; });
