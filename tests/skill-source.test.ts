import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverSkillSource, downloadSkill, fetchSkillSource } from '../server/skill-source.js';
const source = 'https://github.com/acme/tools';
const snapshot = 'a'.repeat(40);
function network(tree: Record<string, unknown>[], contents: Record<string, Buffer | string>, truncated = false) {
    return async (url: string) => {
        const target = new URL(url), path = target.pathname;
        if (path === '/repos/acme/tools') return Buffer.from(JSON.stringify({ private: false, default_branch: 'main' }));
        if (path === '/repos/acme/tools/git/trees/main' || path === '/repos/acme/tools/git/trees/' + snapshot) return Buffer.from(JSON.stringify({ sha: snapshot, truncated, tree }));
        if (target.hostname === 'raw.githubusercontent.com') {
            assert.equal(path.split('/')[3], snapshot);
            const entry = tree.find(entry => entry.path === path.split('/').slice(4).map(decodeURIComponent).join('/'));
            return Buffer.from(contents[String(entry?.sha)]);
        }
        const content = contents[path.split('/').at(-1)!];
        if (content === undefined) throw new Error('Unexpected URL: ' + url);
        return Buffer.from(JSON.stringify({ encoding: 'base64', content: Buffer.from(content).toString('base64') }));
    };
}
const main = { path: 'SKILL.md', sha: 'main', type: 'blob' };
test('source importer enforces byte, count, path and truncated-tree limits before returning a bundle', async () => {
    const cases: { tree: Record<string, unknown>[]; contents: Record<string, Buffer | string>; truncated?: boolean; status: number }[] = [
        { tree: [main], contents: { main: 'x'.repeat(1024 * 1024 + 1) }, status: 413 },
        { tree: [main, { path: '../escape.md', sha: 'bad', type: 'blob' }], contents: { main: '# Good' }, status: 400 },
        { tree: [main], contents: { main: '# Good' }, truncated: true, status: 413 },
        { tree: [main, ...Array.from({ length: 257 }, (_, index) => ({ path: `${index}.txt`, sha: 'extra', type: 'blob' }))], contents: { main: '# Good', extra: 'small' }, status: 413 },
        { tree: [main, ...Array.from({ length: 8 }, (_, index) => ({ path: `${index}.txt`, sha: 'extra', type: 'blob' }))], contents: { main: '# Good', extra: 'x'.repeat(1024 * 1024) }, status: 413 },
    ];
    for (const value of cases) await assert.rejects(downloadSkill(source, network(value.tree, value.contents, value.truncated)), (error: any) => error.status === value.status);
});
test('discovery and selected downloads use the same immutable raw tree without any Blob API calls', async () => {
    const calls: string[] = [], upstream = network([main, { path: 'notes/中文 #?.md', type: 'blob', sha: 'note' }], { main: '# Skill', note: '# Note' });
    const fetcher = (address: string) => { calls.push(address); return upstream(address); };
    const found = await discoverSkillSource(source, fetcher);
    const bundle = await downloadSkill(source, fetcher, { sha: found.sha, path: '' });
    assert.equal(bundle.files[0].content, '# Note');
    assert.equal(calls.some(address => address.includes('/git/blobs/')), false);
    assert(calls.some(address => address.startsWith('https://raw.githubusercontent.com/acme/tools/' + snapshot + '/')));
    assert(calls.some(address => address.endsWith('/notes/%E4%B8%AD%E6%96%87%20%23%3F.md')));
});
test('private repositories are rejected before trees or raw files can be requested', async () => {
    const calls: string[] = [];
    const fetcher = async (address: string) => { calls.push(address); return Buffer.from(JSON.stringify({ private: true, default_branch: 'main' })); };
    await assert.rejects(downloadSkill(source + '/tree/main/skill', fetcher), /公开|私有/);
    assert.deepEqual(calls, ['https://api.github.com/repos/acme/tools']);
});
test('multiple Skills require a precise directory and binary or symlink files are not imported', async () => {
    const tree = [ { path: 'first/SKILL.md', sha: 'main', type: 'blob' }, { path: 'second/SKILL.md', sha: 'main', type: 'blob' }, { path: 'first/payload', sha: 'binary', type: 'blob' }, { path: 'first/symlink', sha: 'link', type: 'blob', mode: '120000' } ];
    const fetcher = network(tree, { main: '# Skill', binary: Buffer.from([0, 1, 2]) });
    await assert.rejects(downloadSkill(source, fetcher), /多个 Skill/);
    const bundle = await downloadSkill(source + '/tree/main/first', fetcher);
    assert.equal(bundle.content, '# Skill');
    assert.equal(bundle.files.length, 0);
    const blob = await downloadSkill(source + '/blob/main/first/SKILL.md', fetcher);
    assert.equal(blob.content, '# Skill');
});
test('HTTP fetcher refuses non-GitHub destinations including redirect targets without issuing requests', async () => {
    for (const url of ['http://api.github.com/repos/acme/tools', 'https://127.0.0.1/internal', 'https://api.github.com.evil.test/secret', 'https://api.github.com:8443/test']) await assert.rejects(fetchSkillSource(url), /不支持/);
});
