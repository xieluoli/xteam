import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase, hashToken, passwordHash, passwordMatches } from './store.js';
import { resources, resourceKinds, ResourceError } from './resources.js';
import { skills } from './skills.js';
import type { SkillFetch } from './skill-source.js';
import { attachMcp } from './mcp.js';
type Member = {
    id: string;
    email: string;
    password: string;
};
type Session = Member & {
    csrf: string;
    hash: string;
};
export function createApp(options: {
    database: string;
    origin: string;
    secure?: boolean;
    skillFetch?: SkillFetch;
}) {
    const database = openDatabase(options.database);
    const app = express();
    app.disable('x-powered-by');
    app.locals.database = database;
    app.use((_request, response, next) => {
        response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        next();
    });
    app.use(express.json({ limit: '2mb' }));
    app.get('/health', (_request, response) => response.json({ ok: true, version: process.env.XTEAM_VERSION ?? 'development' }));
    const attempts = new Map<string, {
        count: number;
        until: number;
    }>();
    const dummy = passwordHash(randomBytes(32).toString('hex'));
    app.use('/api', (request, response, next) => {
        response.set('Cache-Control', 'no-store');
        if (!['GET', 'HEAD'].includes(request.method) && request.get('origin') !== options.origin) {
            response.status(403).json({ error: '请求来源不受信任，请刷新后重试' });
            return;
        }
        next();
    });
    app.post('/api/login', (request, response) => {
        const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
        const password = typeof request.body?.password === 'string' ? request.body.password : '';
        const key = request.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        if (attempts.size > 10000)
            for (const [address, value] of attempts)
                if (value.until < now)
                    attempts.delete(address);
        const attempt = attempts.get(key);
        if (attempt && attempt.until > now && attempt.count >= 15) {
            response.status(429).json({ error: '尝试过多，请 15 分钟后重试' });
            return;
        }
        const user = database.prepare('SELECT id,email,password FROM users WHERE email=? AND enabled=1').get(email) as Member | undefined;
        const valid = passwordMatches(password, user?.password ?? dummy);
        if (!user || !valid) {
            attempts.set(key, { count: (attempt && attempt.until > now ? attempt.count : 0) + 1, until: now + 900000 });
            response.status(401).json({ error: '邮箱或密码不正确，或账号未获准访问' });
            return;
        }
        attempts.delete(key);
        const token = randomBytes(32).toString('hex');
        const csrf = randomBytes(24).toString('hex');
        database.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
        database.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hashToken(token), user.id, csrf, now + 7 * 86400000);
        response.cookie('xteam_session', token, { httpOnly: true, secure: options.secure ?? true, sameSite: 'strict', maxAge: 7 * 86400000, path: '/' });
        response.json({ user: { id: user.id, email: user.email }, csrf });
    });
    app.use('/api', (request, response, next) => {
        const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('xteam_session='))?.slice(14);
        const session = token ? database.prepare('SELECT users.id,users.email,users.password,sessions.csrf,sessions.hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>? AND users.enabled=1').get(hashToken(token), Date.now()) as Session | undefined : undefined;
        if (!session) {
            response.status(401).json({ error: '请先登录' });
            return;
        }
        if (!['GET', 'HEAD'].includes(request.method) && request.get('x-csrf-token') !== session.csrf) {
            response.status(403).json({ error: '登录状态已变化，请刷新后重试' });
            return;
        }
        response.locals.member = session;
        next();
    });
    app.get('/api/me', (_request, response) => { const user = response.locals.member as Session; response.json({ user: { id: user.id, email: user.email }, csrf: user.csrf }); });
    app.post('/api/logout', (_request, response) => {
        database.prepare('DELETE FROM sessions WHERE hash=?').run((response.locals.member as Session).hash);
        response.clearCookie('xteam_session', { path: '/' });
        response.json({ ok: true });
    });
    app.post('/api/password', (request, response) => {
        const member = response.locals.member as Session;
        if (typeof request.body?.current !== 'string' || !passwordMatches(request.body.current, member.password)) {
            response.status(400).json({ error: '当前密码不正确' });
            return;
        }
        if (typeof request.body?.password !== 'string') {
            response.status(400).json({ error: '请填写新密码' });
            return;
        }
        const encoded = passwordHash(request.body.password);
        database.transaction(() => {
            database.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, member.id);
            database.prepare('DELETE FROM sessions WHERE user_id=?').run(member.id);
        })();
        response.clearCookie('xteam_session', { path: '/' });
        response.json({ ok: true });
    });
    const service = resources(database);
    app.get('/api/projects/:id/context', (request, response) => response.json(service.context(String(request.params.id))));
    const skillService = skills(database, options.skillFetch);
    app.post('/api/skills/import', async (request, response) => { const result = await skillService.importUrl(request.body, response.locals.member.id); response.status(result.status === 'conflict' ? 409 : result.status === 'created' ? 201 : 200).json(result); });
    app.get('/api/skills', (request, response) => response.json(skillService.list(typeof request.query.q === 'string' ? request.query.q : '')));
    app.post('/api/skills', () => { throw new ResourceError('新增 Skill 仅支持 URL 导入，请使用 /api/skills/import'); });
    app.get('/api/skills/:id', (request, response) => response.json(skillService.get(String(request.params.id))));
    app.patch('/api/skills/:id', (request, response) => response.json(skillService.update(String(request.params.id), request.body, response.locals.member.id)));
    app.delete('/api/skills/:id', (request, response) => response.json(skillService.remove(String(request.params.id))));
    app.post('/api/skills/:id/refresh', async (request, response) => response.json(await skillService.refresh(String(request.params.id), response.locals.member.id)));
    app.put('/api/skills/:id/files', (request, response) => response.json(skillService.file(String(request.params.id), String(request.body.path ?? ''), request.body.content, response.locals.member.id)));
    app.delete('/api/skills/:id/files', (request, response) => response.json(skillService.file(String(request.params.id), String(request.body.path ?? ''), undefined, response.locals.member.id, true)));
    for (const kind of resourceKinds) {
        app.get(`/api/${kind}`, (request, response) => response.json(service.list(kind, typeof request.query.q === 'string' ? request.query.q : '', typeof request.query.project_id === 'string' ? request.query.project_id : undefined)));
        app.get(`/api/${kind}/:id`, (request, response) => response.json(service.get(kind, String(request.params.id))));
        app.post(`/api/${kind}`, (request, response) => response.status(201).json(service.save(kind, request.body)));
        app.patch(`/api/${kind}/:id`, (request, response) => response.json(service.update(kind, String(request.params.id), request.body)));
        app.delete(`/api/${kind}/:id`, (request, response) => response.json(service.remove(kind, String(request.params.id))));
    }
    app.get('/api/tokens', (_request, response) => response.json(database.prepare('SELECT id,name,created_at FROM tokens WHERE user_id=? ORDER BY created_at DESC').all(response.locals.member.id)));
    app.post('/api/tokens', (request, response) => {
        const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
        if (!name || name.length > 100)
            throw new ResourceError('令牌名称需为 1–100 个字符');
        const id = randomUUID();
        const token = 'xt_' + randomBytes(32).toString('hex');
        database.prepare('INSERT INTO tokens VALUES (?,?,?,?,?)').run(id, response.locals.member.id, name, hashToken(token), new Date().toISOString());
        response.status(201).json({ id, name, token });
    });
    app.delete('/api/tokens/:id', (request, response) => {
        const result = database.prepare('DELETE FROM tokens WHERE id=? AND user_id=?').run(String(request.params.id), response.locals.member.id);
        if (!result.changes)
            throw new ResourceError('令牌不存在', 404);
        response.json({ ok: true });
    });
    attachMcp(app, database, options.origin, options.skillFetch);
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (request, response, next) => { if (request.path.startsWith('/api/') || request.path === '/mcp') {
        next();
        return;
    } response.sendFile(resolve('dist/index.html')); });
    app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
        const message = error instanceof Error ? error.message : '请求失败';
        response.status(error instanceof ResourceError ? error.status : 400).json({ error: message.includes('SQLITE') ? '数据操作失败，请检查关联资源是否仍存在' : message });
    });
    return app;
}
