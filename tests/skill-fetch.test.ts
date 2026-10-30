import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { discoverSkillSource, downloadSkill, fetchSkillSource } from '../server/skill-source.js';

function network(context: TestContext, respond: (url: URL, headers: Record<string, string>) => { status?: number; headers?: Record<string, string>; body?: string }) {
    let calls = 0;
    context.mock.method(https, 'request', ((url: URL, options: https.RequestOptions, callback: (response: unknown) => void) => {
        calls++;
        const outgoing = Object.assign(new EventEmitter(), {
            end() { queueMicrotask(() => {
                const reply = respond(url, options.headers as Record<string, string>);
                const response = Object.assign(new EventEmitter(), { statusCode: reply.status ?? 200, headers: reply.headers ?? {}, resume() {}, destroy(error: Error) { response.emit('error', error); } });
                callback(response);
                response.emit('data', Buffer.from(reply.body ?? '{}'));
                response.emit('end');
                outgoing.emit('close');
            }); },
            destroy(error: Error) { outgoing.emit('error', error); outgoing.emit('close'); }
        });
        return outgoing;
    }) as unknown as typeof https.request);
    syncBuiltinESMExports();
    context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
    return { get calls() { return calls; } };
}

test('source transport keeps optional credentials on the API host and refuses unpinned raw or redirected destinations', async context => {
    const original = process.env.XTEAM_GITHUB_TOKEN;
    process.env.XTEAM_GITHUB_TOKEN = 'fixture-public-read-only';
    context.after(() => { if (original === undefined) delete process.env.XTEAM_GITHUB_TOKEN; else process.env.XTEAM_GITHUB_TOKEN = original; });
    const upstream = network(context, (url, headers) => {
        assert.equal(headers.Authorization, url.hostname === 'api.github.com' ? 'Bearer fixture-public-read-only' : undefined);
        return url.pathname.endsWith('/redirect') ? { status: 302, headers: { location: 'https://127.0.0.1/secret' } } : {};
    });
    await fetchSkillSource('https://api.github.com/repos/auth-check/tools');
    await fetchSkillSource('https://raw.githubusercontent.com/auth-check/tools/' + 'a'.repeat(40) + '/SKILL.md');
    for (const url of ['https://raw.githubusercontent.com/auth-check/tools/main/SKILL.md', 'https://raw.githubusercontent.com.evil.test/a/b/' + 'a'.repeat(40) + '/SKILL.md', 'https://raw.githubusercontent.com/a/b/' + 'a'.repeat(40) + '/SKILL.md?token=bad']) await assert.rejects(fetchSkillSource(url), /不支持/);
    assert.equal(upstream.calls, 2);
    await assert.rejects(fetchSkillSource('https://api.github.com/repos/auth-check/redirect'), /302/);
    assert.equal(upstream.calls, 3);
});
test('source cache merges concurrent reads, expires mutable refs and bounds retained responses', async context => {
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    let revision = 'one';
    const upstream = network(context, () => ({ body: revision }));
    const branch = 'https://api.github.com/repos/cache-check/tools/git/trees/main?recursive=1';
    const raw = 'https://raw.githubusercontent.com/cache-check/tools/' + 'b'.repeat(40) + '/SKILL.md';
    const reads = await Promise.all([fetchSkillSource(branch), fetchSkillSource(branch), fetchSkillSource(branch)]);
    assert.equal(upstream.calls, 1); assert.equal(reads[0].toString(), 'one');
    await fetchSkillSource(raw);
    revision = 'two'; context.mock.timers.tick(31_000);
    assert.equal((await fetchSkillSource(branch)).toString(), 'two');
    assert.equal((await fetchSkillSource(raw)).toString(), 'one');
    for (let index = 0; index < 129; index++) await fetchSkillSource('https://api.github.com/repos/cache-bound-' + index + '/tools');
    const before = upstream.calls;
    await fetchSkillSource('https://api.github.com/repos/cache-bound-0/tools');
    assert.equal(upstream.calls, before + 1);
});
test('rate limiting reports the actual reset time without caching failure or mistaking forbidden access for quota exhaustion', async context => {
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    let status = 403;
    const reset = Math.floor(Date.now() / 1000) + 120;
    const upstream = network(context, url => {
        const headers: Record<string, string> = url.pathname.endsWith('/forbidden') ? {} : url.pathname.endsWith('/secondary') ? { 'retry-after': '90' } : { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) };
        return { status, headers };
    });
    const url = 'https://api.github.com/repos/rate-check/tools';
    await assert.rejects(fetchSkillSource(url), (error: any) => error.status === 429 && /GitHub|配额/.test(error.message) && /北京时间/.test(error.message));
    status = 200; await fetchSkillSource(url); assert.equal(upstream.calls, 2);
    status = 403; await assert.rejects(fetchSkillSource('https://api.github.com/repos/rate-check/forbidden'), (error: any) => error.status === 502 && /403/.test(error.message) && !/配额/.test(error.message));
    const expected = new Date((reset - 120) * 1000 + 90_000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    await assert.rejects(fetchSkillSource('https://api.github.com/repos/rate-check/secondary'), (error: any) => error.status === 429 && error.message.includes(expected));
});
test('five-Skill discovery, import and refresh spend three API requests and download each immutable file once', async context => {
    const sha = 'c'.repeat(40), requests: URL[] = [];
    const tree = Array.from({ length: 5 }, (_, skill) => Array.from({ length: 7 }, (_, file) => ({ path: `skills/skill-${skill}/${file ? `notes/${file}.md` : 'SKILL.md'}`, type: 'blob', sha: 'd'.repeat(40), size: 9 }))).flat();
    network(context, url => {
        requests.push(url);
        return { body: url.hostname === 'raw.githubusercontent.com' ? '# fixture' : JSON.stringify(url.pathname.includes('/git/trees/') ? { sha, tree } : { private: false, default_branch: 'main' }) };
    });
    const source = 'https://github.com/cache-suite/pmspec';
    const found = await discoverSkillSource(source);
    for (const candidate of found.candidates) await downloadSkill(source, undefined, { sha: found.sha, path: candidate.path });
    await downloadSkill(source + '/tree/main/skills/skill-0');
    assert.equal(requests.filter(url => url.hostname === 'api.github.com').length, 3);
    assert.equal(requests.filter(url => url.hostname === 'raw.githubusercontent.com').length, 35);
});
test('raw source DNS keeps the existing all-address public-network check', async context => {
    context.mock.method(dns, 'lookup', ((_host: unknown, _options: unknown, callback: (error: unknown, addresses: unknown[]) => void) => callback(null, [{ address: '140.82.112.1', family: 4 }, { address: '127.0.0.1', family: 4 }])) as unknown as typeof dns.lookup);
    context.mock.method(https, 'request', ((_url: URL, options: https.RequestOptions) => {
        const outgoing = Object.assign(new EventEmitter(), { end() { (options.lookup as any)('raw.githubusercontent.com', { all: true }, (error: Error) => { outgoing.emit('error', error); outgoing.emit('close'); }); }, destroy() {} });
        return outgoing;
    }) as unknown as typeof https.request);
    syncBuiltinESMExports();
    context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
    await assert.rejects(fetchSkillSource('https://raw.githubusercontent.com/dns-check/tools/' + 'd'.repeat(40) + '/SKILL.md'), /拒绝访问非公网地址/);
});
