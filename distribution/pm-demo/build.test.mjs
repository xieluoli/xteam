import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const build = fileURLToPath(new URL('./build.mjs', import.meta.url));
test('builds a self-contained release that installs both roles and all six skills offline', async context => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pm-package-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  const result = spawnSync(process.execPath, [build, '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(await readFile(join(output, 'release.json'), 'utf8'));
  const archive = join(output, metadata.filename);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), metadata.sha256);
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0);
  assert.doesNotMatch(listing.stdout, /\._|__MACOSX/);
  const extract = join(root, 'extract'); await mkdir(extract);
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', extract], { encoding: 'utf8' });
  assert.equal(unpack.status, 0, unpack.stderr);
  const bundle = join(extract, 'pm-demo');
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.filter(f => f.path.startsWith('skills/') && f.path.endsWith('/SKILL.md')).length, 6);
  assert.ok(manifest.files.some(f => f.path === 'agents/pm-demo.toml'));
  assert.ok(manifest.files.some(f => f.path === 'agents/prototype-review.toml'));
  const workspace = join(root, 'product'); await mkdir(workspace);
  const install = spawnSync(process.execPath, [join(bundle, 'install.mjs'), '--workspace', workspace], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  assert.equal(await readFile(join(workspace, '.xteam/licenses/pm-demo/LICENSE'), 'utf8'), await readFile(join(bundle, 'LICENSE'), 'utf8'));
  assert.equal((await readdir(join(workspace, '.codex/agents'))).length, 2);
  assert.equal((await readdir(join(workspace, '.agents/skills'))).length, 6);
  // The installed validator must run offline with its matching checklist.
  const report = `| C1 | 10 | 已验证 | fixture |
| C2 | 10 | 已验证 | fixture |
| C3 | 10 | 已验证 | fixture |
| L1 | 10 | 已验证 | fixture |
| L2 | 10 | 已验证 | fixture |
| V1 | 5 | 已验证 | fixture |
| V2 | 5 | 已验证 | fixture |
| V3 | 5 | 已验证 | fixture |
| R1 | 5 | 已验证 | fixture |
| R2 | 5 | 已验证 | fixture |
| R3 | 5 | 已验证 | fixture |
| E1 | 5 | 已验证 | fixture |
| E2 | 5 | 已验证 | fixture |
| A1 | 5 | 已验证 | fixture |
| A2 | 5 | 已验证 | fixture |
组件复用与变体：30
页面骨架与布局：20
视觉规范：15
需求与范围一致性：15
交互与运行证据：10
平铺展示与旁注：10
总分：100
必改项：0
待确认项：0
必需证据：齐全
审核通过 100分
`;
  const reportPath = join(root, 'review.md');
  const validator = join(workspace, '.agents/skills/pmspec-apply/scripts/check-review.mjs');
  await writeFile(reportPath, report);
  const accepted = spawnSync(process.execPath, [validator, reportPath], { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).total, 100);
  await writeFile(reportPath, report.replace('必改项：0', '必改项：1'));
  const contradictory = spawnSync(process.execPath, [validator, reportPath], { encoding: 'utf8' });
  assert.equal(contradictory.status, 2, contradictory.stderr);
  const belowThreshold = report.replace('| C1 | 10 | 已验证', '| C1 | 0 | 缺陷')
    .replace('| V1 | 5 | 已验证', '| V1 | 0 | 缺陷')
    .replace('组件复用与变体：30', '组件复用与变体：20')
    .replace('视觉规范：15', '视觉规范：10')
    .replace('总分：100', '总分：85').replace('审核通过 100分', '审核不通过 85分');
  await writeFile(reportPath, belowThreshold);
  const rejected = spawnSync(process.execPath, [validator, reportPath], { encoding: 'utf8' });
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).passed, false);
  const agent = await readFile(join(workspace, '.codex/agents/pm-demo.toml'), 'utf8');
  assert.match(agent, /developer_instructions/);
  assert.match(agent, /pmspec-explore/);
  assert.doesNotMatch(agent, /foxmail|\/Users\//);
  assert.equal(resolve(JSON.parse(install.stdout).workspace), resolve(workspace));
});
