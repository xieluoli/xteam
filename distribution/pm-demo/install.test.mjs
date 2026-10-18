import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, symlink, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('./install.mjs', import.meta.url));
const digest = (body) => createHash('sha256').update(body).digest('hex');
async function fixture(context) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'xteam-pm-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bundle = join(root, 'bundle');
  const workspace = join(root, 'product');
  await mkdir(bundle); await mkdir(workspace);
  const contents = {
    'LICENSE': 'MIT License\nCopyright (c) 2026 xieluoli\n',
    'agents/pm-demo.toml': 'name = "pm-demo"\ndescription = "PM"\ndeveloper_instructions = "Product work"\n',
    'agents/prototype-review.toml': 'name = "prototype-review"\ndescription = "Review"\ndeveloper_instructions = "Read only"\n',
    ...Object.fromEntries(['cn-commit', 'pmspec-init', 'pmspec-explore', 'pmspec-propose', 'pmspec-apply', 'pmspec-review'].map(name => [`skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n# ${name}\n`])),
    'skills/pmspec-apply/references/review-checklist.md': '# Review checklist\n',
  };
  const files = [];
  for (const [path, content] of Object.entries(contents)) {
    await mkdir(dirname(join(bundle, path)), { recursive: true });
    await writeFile(join(bundle, path), content);
    files.push({ path, sha256: digest(content) });
  }
  const manifest = { format: 1, name: 'pm-demo', version: 'test-v1', files };
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));
  return { root, bundle, workspace, manifest, contents };
}
function run(bundle, workspace, flags = []) {
  return spawnSync(process.execPath, [installer, '--bundle', bundle, '--workspace', workspace, ...flags], { encoding: 'utf8' });
}
async function rewriteManifest(fixture) {
  await writeFile(join(fixture.bundle, 'manifest.json'), JSON.stringify(fixture.manifest));
}

test('installs native agents, six complete skills and an honest receipt, then is idempotent', async context => {
  const f = await fixture(context);
  const result = run(f.bundle, f.workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(f.workspace, '.codex/agents/pm-demo.toml'), 'utf8'), f.contents['agents/pm-demo.toml']);
  assert.equal(await readFile(join(f.workspace, '.agents/skills/pmspec-apply/references/review-checklist.md'), 'utf8'), '# Review checklist\n');
  assert.equal((await readdir(join(f.workspace, '.agents/skills'))).length, 6);
  const receipt = JSON.parse(await readFile(join(f.workspace, '.xteam/installs/pm-demo.json'), 'utf8'));
  assert.equal(receipt.runtimeDiscovery, 'not_verified');
  assert.equal(receipt.version, 'test-v1');
  assert.equal(receipt.files.length, 10);
  const second = run(f.bundle, f.workspace);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).newFiles, 0);
  assert.equal((await lstat(join(f.workspace, '.codex/agents/pm-demo.toml'))).isFile(), true);
});

test('check mode validates the entire bundle without writing any destination', async context => {
  const f = await fixture(context);
  const result = run(f.bundle, f.workspace, ['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(f.workspace), []);
});

test('a differing existing file aborts the whole install and preserves user files', async context => {
  const f = await fixture(context);
  await mkdir(join(f.workspace, '.agents/skills/pmspec-review'), { recursive: true });
  const path = join(f.workspace, '.agents/skills/pmspec-review/SKILL.md');
  await writeFile(path, 'my local review');
  const result = run(f.bundle, f.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflict/i);
  assert.equal(await readFile(path, 'utf8'), 'my local review');
  assert.deepEqual(await readdir(f.workspace), ['.agents']);
});

test('an additional local skill file is not silently retained as part of the installed snapshot', async context => {
  const f = await fixture(context);
  await mkdir(join(f.workspace, '.agents/skills/pmspec-apply'), { recursive: true });
  await writeFile(join(f.workspace, '.agents/skills/pmspec-apply/extra.md'), 'local rules');
  const result = run(f.bundle, f.workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflict/i);
  assert.deepEqual(await readdir(f.workspace), ['.agents']);
});

test('tampered or missing skill dependencies fail before any write', async context => {
  for (const mode of ['tampered', 'missing']) {
    const f = await fixture(context);
    const path = join(f.bundle, 'skills/pmspec-apply/references/review-checklist.md');
    if (mode === 'tampered') await writeFile(path, 'tampered'); else await rm(path);
    const result = run(f.bundle, f.workspace);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readdir(f.workspace), []);
  }
});

test('rejects manifest traversal, absolute paths, duplicates and missing required role', async context => {
  for (const mode of ['../escape', '/absolute', 'skills/pmspec-apply/../../escape', 'skills/pmspec-apply/file:stream', 'duplicate', 'missing-role']) {
    const f = await fixture(context);
    if (mode === 'missing-role') f.manifest.files = f.manifest.files.filter(file => file.path !== 'agents/pm-demo.toml');
    else if (mode === 'duplicate') f.manifest.files.push(f.manifest.files[0]);
    else f.manifest.files.push({ path: mode, sha256: digest('bad') });
    await rewriteManifest(f);
    const result = run(f.bundle, f.workspace);
    assert.notEqual(result.status, 0, mode);
    assert.deepEqual(await readdir(f.workspace), []);
  }
});

test('rejects destination symlink parents instead of writing outside the project', async context => {
  const f = await fixture(context);
  const outside = join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.workspace, '.codex'), 'dir');
  const result = run(f.bundle, f.workspace);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(f.workspace), ['.codex']);
});

test('rejects source symlinks even when their content matches the hash', async context => {
  const f = await fixture(context);
  const file = join(f.bundle, 'agents/pm-demo.toml');
  const outside = join(f.root, 'outside.toml');
  await writeFile(outside, f.contents['agents/pm-demo.toml']); await rm(file); await symlink(outside, file);
  assert.notEqual(run(f.bundle, f.workspace).status, 0);
  assert.deepEqual(await readdir(f.workspace), []);
});

test('rolls back this attempt on a late write error, preserving pre-existing data', async context => {
  const f = await fixture(context);
  await writeFile(join(f.workspace, 'AGENTS.md'), 'keep user rules');
  // A second process creates a conflicting destination after preflight. The
  // injected filesystem fault lives outside production via a Node preload.
  const preload = join(f.root, 'fault.cjs');
  await writeFile(preload, `const fs = require('node:fs/promises');const original=fs.open;let calls=0;fs.open=async(...args)=>{if(++calls===3)throw Object.assign(new Error('disk failure'),{code:'EIO'});return original(...args)};require('node:module').syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ['--require', preload, installer, '--bundle', f.bundle, '--workspace', f.workspace], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(join(f.workspace, 'AGENTS.md'), 'utf8'), 'keep user rules');
  assert.deepEqual(await readdir(f.workspace), ['AGENTS.md']);
});

test('cleans a partially created file after a write failure', async context => {
  const f = await fixture(context);
  const preload = join(f.root, 'partial.cjs');
  await writeFile(preload, `const fs=require('node:fs/promises');const original=fs.open;fs.open=async(...args)=>{const handle=await original(...args);const write=handle.writeFile.bind(handle);handle.writeFile=async()=>{await write('partial');throw new Error('partial disk write')};return handle};require('node:module').syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ['--require', preload, installer, '--bundle', f.bundle, '--workspace', f.workspace], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readdir(f.workspace), []);
});

test('rejects unsupported flags and nonexistent project roots', async context => {
  const f = await fixture(context);
  assert.notEqual(run(f.bundle, f.workspace, ['--force']).status, 0);
  assert.notEqual(run(f.bundle, join(f.root, 'missing')).status, 0);
});
