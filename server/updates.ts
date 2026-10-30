import type { Express } from 'express';
import { request } from 'node:http';
import { ResourceError } from './resources.js';

export type UpgradeOptions = { socket: string; admins: string[] };
export function attachUpdates(app: Express, options?: UpgradeOptions) {
    function host(path: string, method = 'GET', data?: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const call = request({ socketPath: options!.socket, path, method, headers: { 'Content-Type': 'application/json' }, timeout: 5000 }, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; if (body.length > 65536) call.destroy(new Error('响应过大')); });
                response.on('end', () => { try {
                    const value = JSON.parse(body);
                    if ((response.statusCode ?? 500) >= 400) reject(new ResourceError(value.error ?? '升级请求失败', response.statusCode));
                    else resolve(value);
                } catch { reject(new ResourceError('升级服务响应无效', 503)); } });
                response.on('error', () => reject(new ResourceError('升级服务暂不可用', 503)));
            });
            call.on('timeout', () => call.destroy(new Error('升级服务超时')));
            call.on('error', () => reject(new ResourceError('升级服务暂不可用，请联系部署管理员', 503)));
            call.end(data === undefined ? undefined : JSON.stringify(data));
        });
    }
    app.get('/api/updates', async (_request, response) => {
        const canUpgrade = Boolean(options?.socket && options.admins.includes(response.locals.member.email.toLowerCase()));
        const state = options?.socket ? await host('/status') : { phase: 'idle', message: '此实例尚未启用升级服务' };
        response.json({ enabled: Boolean(options?.socket), canUpgrade, currentVersion: process.env.XTEAM_VERSION ?? 'development', state });
    });
    for (const action of ['check', 'upgrade']) app.post('/api/updates/' + action, async (request, response) => {
        if (!options?.socket || !options.admins.includes(response.locals.member.email.toLowerCase())) throw new ResourceError('仅部署管理员可以检查或执行升级', 403);
        const body = request.body;
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new ResourceError('升级参数无效');
        if (action === 'check') {
            if (Object.keys(body).length) throw new ResourceError('检查更新不接受额外参数');
        } else if (Object.keys(body).sort().join(',') !== 'releaseId,sha' || !Number.isSafeInteger(body.releaseId) || body.releaseId <= 0 || typeof body.sha !== 'string' || !/^[a-f0-9]{40}$/.test(body.sha)) throw new ResourceError('请先检查并选择有效的 Release');
        response.status(202).json(await host('/' + action, 'POST', action === 'check' ? {} : { releaseId: body.releaseId, sha: body.sha }));
    });
}
