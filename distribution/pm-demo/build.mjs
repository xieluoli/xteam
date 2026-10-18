import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const source = dirname(fileURLToPath(import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node build.mjs --output <release directory>');
const output = resolve(args[1]);
const temporary = await mkdtemp(join(tmpdir(), 'pm-release-'));
try {
  const bundle = join(temporary, 'pm-demo');
  await mkdir(join(bundle, 'agents'), { recursive: true });
  const lock = JSON.parse(await readFile(join(source, 'source-lock.json'), 'utf8'));
  const capabilities = await readFile(join(source, 'capabilities.md'), 'utf8');
  if (hash(capabilities) !== lock.instructionsSha256) throw new Error('PM capabilities differ from locked source');
  const actualSource = [];
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path);
      else if (entry.isFile()) actualSource.push(path);
      else throw new Error(`Unsupported source type: ${path}`);
    }
  }
  await walk(join(source, 'skills'), 'skills');
  if (actualSource.length !== Object.keys(lock.files).length) throw new Error('Skill inventory differs from lock');
  for (const path of actualSource) {
    if (hash(await readFile(join(source, path))) !== lock.files[path]) throw new Error(`Source integrity mismatch: ${path}`);
  }
  await cp(join(source, 'skills'), join(bundle, 'skills'), { recursive: true });
  const workflowIndex = `\n\n本地技能位于当前产品目录 .agents/skills/。仅在用户明确选择阶段后读取对应 SKILL.md 与引用文件，不默认连续执行阶段。五项 PMSpec 阶段：pmspec-init、pmspec-explore、pmspec-propose、pmspec-apply、pmspec-review。提交时按 cn-commit，仅在用户明确授权后提交。\n每项技能完整文件都在同名目录；读取本地说明不等于已通过宿主原生 Skill 调用。\npmspec-apply 所需独立审核角色名为 prototype-review；由主协调 Agent 按宿主能力拉起，不用主角色自审冒充独立审核。若当前角色不能启动独立审核，交还主协调 Agent 并报告阻塞。\n不在 xteam 上运行任务、不安装 MCP、不修改全局权限、模型或用户准则。`;
  const agent = `name = "pm-demo"\ndescription = "产品经理：明确需求，经批准后维护提案与原型，协调独立审核"\ndeveloper_instructions = ${JSON.stringify(capabilities.trim() + workflowIndex)}\n`;
  await writeFile(join(bundle, 'agents/pm-demo.toml'), agent);
  await copyFile(join(source, 'skills/pmspec-apply/agents/prototype-review.toml'), join(bundle, 'agents/prototype-review.toml'));
  for (const file of ['install.mjs', 'INSTALL.md', 'SOURCE.md', 'PMSPEC-SOURCES.md', 'LICENSE']) await copyFile(join(source, file), join(bundle, file));
  const files = [];
  const releaseMembers = [];
  async function collect(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await collect(join(directory, entry.name), path);
      else {
        const member = { path, sha256: hash(await readFile(join(directory, entry.name))) };
        releaseMembers.push(member);
        if (path.startsWith('agents/') || path.startsWith('skills/') || path === 'LICENSE') files.push(member);
      }
    }
  }
  await collect(bundle);
  const version = hash(JSON.stringify({ releaseMembers, pmspecCommit: lock.pmspecCommit })).slice(0, 16);
  const manifest = { format: 1, name: 'pm-demo', version, source: { repository: 'https://github.com/xieluoli/xteam', pmspecCommit: lock.pmspecCommit }, files };
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(output, { recursive: true });
  const filename = `pm-demo-codex-${version}.tar.gz`;
  const result = spawnSync('tar', ['-czf', join(output, filename), '-C', temporary, 'pm-demo'], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (result.status !== 0) throw new Error(result.stderr || 'tar failed');
  const sha256 = hash(await readFile(join(output, filename)));
  await writeFile(join(output, 'release.json'), JSON.stringify({ version, filename, sha256, agentInstructions: capabilities.trim(), skillNames: ['cn-commit', 'pmspec-apply', 'pmspec-explore', 'pmspec-init', 'pmspec-propose', 'pmspec-review'], pmspecCommit: lock.pmspecCommit }, null, 2) + '\n');
  await writeFile(join(output, 'SHA256SUMS'), `${sha256}  ${filename}\n`);
  console.info(JSON.stringify({ version, filename, sha256, output }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
