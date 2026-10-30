import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverSkillSource, downloadSkill } from '../server/skill-source.js';
import { multiSkillNetwork, snapshot } from './multi-skill-network.js';

const url = 'https://github.com/example/pmspec';
test('repository and parent directory discover five candidates; selected bundles remain pinned and isolated', async () => {
    const network = multiSkillNetwork();
    for (const address of [url, url + '/tree/main/skills']) {
        const found = await discoverSkillSource(address, network.fetcher);
        assert.equal(found.sha, snapshot); assert.equal(found.ref, 'main');
        assert.equal(found.candidates.length, 5);
        assert.equal(found.candidates[0].path, 'skills/pmspec-apply');
        assert.match(found.candidates[0].content, /name: pmspec-apply/);
    }
    network.state.branchMoved = true;
    const bundle = await downloadSkill(url, network.fetcher, { sha: snapshot, path: 'skills/pmspec-apply' });
    assert.match(bundle.content, /# apply/);
    assert.deepEqual(bundle.files.map(file => file.path), ['references/note.md']);
    assert.match(bundle.files[0].content, /apply-note/);
    assert.equal(bundle.source_url, url + '/tree/main/skills/pmspec-apply');
    assert.equal(network.calls.at(-2)?.includes('/git/blobs/apply'), true);
    await assert.rejects(downloadSkill(url + '/tree/main/skills/pmspec-review', network.fetcher, { sha: snapshot, path: 'skills/pmspec-apply' }), /选择|目录/);
    await assert.rejects(downloadSkill(url, network.fetcher, { sha: snapshot, path: '../escape' }), /路径|选择/);
});
test('discovery rejects empty, excessive and truncated candidates without silently dropping entries', async () => {
    const network = multiSkillNetwork();
    network.state.count = 0; await assert.rejects(discoverSkillSource(url, network.fetcher), /未找到/);
    network.state.count = 21; await assert.rejects(discoverSkillSource(url, network.fetcher), /20/);
    network.state.count = 5; network.state.truncated = true;
    await assert.rejects(discoverSkillSource(url, network.fetcher), /不完整|过大/);
});
test('root Skill and nested Skills stay discoverable while each bundle excludes the other Skill directories', async () => {
    const paths = ['SKILL.md', 'root.md', 'parent/SKILL.md', 'parent/reference.md', 'parent/child/SKILL.md', 'parent/child/reference.md', 'sibling/SKILL.md', '.private/SKILL.md', 'linked/SKILL.md'];
    const fetcher = async (address: string) => {
        const path = new URL(address).pathname;
        if (path.endsWith('/pmspec')) return Buffer.from(JSON.stringify({ default_branch: 'main' }));
        if (path.includes('/git/trees/')) return Buffer.from(JSON.stringify({ sha: snapshot, tree: paths.map((entry, index) => ({ path: entry, type: 'blob', sha: String(index), mode: entry.startsWith('linked/') ? '120000' : '100644' })) }));
        return Buffer.from(JSON.stringify({ encoding: 'base64', content: Buffer.from('# ' + paths[Number(path.split('/').at(-1))]).toString('base64') }));
    };
    assert.deepEqual((await discoverSkillSource(url, fetcher)).candidates.map(item => item.path), ['', 'parent', 'parent/child', 'sibling']);
    const root = await downloadSkill(url, fetcher, { sha: snapshot, path: '' });
    assert.deepEqual(root.files.map(item => item.path), ['root.md']);
    assert.equal(root.source_url, url + '/tree/main');
    const parent = await downloadSkill(url, fetcher, { sha: snapshot, path: 'parent' });
    assert.deepEqual(parent.files.map(item => item.path), ['reference.md']);
    assert.equal(parent.files[0].content, '# parent/reference.md');
    assert.equal((await discoverSkillSource(url + '/blob/main/parent/SKILL.md', fetcher)).candidates.length, 1);
    assert.equal((await discoverSkillSource(url + '/tree/main/parent', fetcher)).candidates.length, 2);
    await assert.rejects(downloadSkill(url, async address => {
        const response = await fetcher(address);
        return address.includes('/git/trees/') ? Buffer.from(response.toString().replace(snapshot, 'b'.repeat(40))) : response;
    }, { sha: snapshot, path: 'parent' }), /快照不匹配/);
});
