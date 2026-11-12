import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, provisionUser } from '../server/store.js';
import { knowledge } from '../server/knowledge.js';
import { resources } from '../server/resources.js';
import { skills } from '../server/skills.js';

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'xteam-knowledge-'));
    const db = openDatabase(join(directory, 'wiki.db'));
    const member = provisionUser(db, 'wiki@example.com', 'wiki-test-password');
    const service = knowledge(db);
    return { db, member, service, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('Wiki pages preserve history, reject stale writes and invalid trees, and search Chinese content', () => {
    const f = fixture();
    try {
        const s = f.service.createSpace({ name: '产品资料' }, f.member);
        const other = f.service.createSpace({ name: '另一个空间' }, f.member);
        const root = f.service.createPage({ space_id: s.id, title: '产品概览', content: '组织知识' }, f.member);
        const child = f.service.createPage({ space_id: s.id, parent_id: root.id, title: '调研', content: '项圈用户研究' }, f.member);
        assert.throws(() => f.service.updatePage(root.id, { parent_id: child.id, expected_version: root.version }, f.member), /循环/);
        assert.throws(() => f.service.createPage({ space_id: other.id, parent_id: root.id, title: '错误位置' }, f.member), /同一空间/);
        const updated = f.service.updatePage(child.id, { content: '新的项圈研究', expected_version: child.version }, f.member);
        assert.equal(updated.version, 2);
        assert.throws(() => f.service.updatePage(child.id, { content: '旧设备', expected_version: 1 }, f.member), /冲突/);
        assert.throws(() => f.service.updatePage(child.id, { content: '未带版本' }, f.member), /expected_version/);
        assert.equal(f.service.history(child.id)[0].content, '新的项圈研究');
        assert.equal(f.service.history(child.id).length, 2);
        assert.equal(f.service.search('项圈', s.id)[0].id, child.id);
        f.service.updatePage(child.id, { archived: true, expected_version: updated.version }, f.member);
        assert.equal(f.service.search('项圈', s.id).length, 0);
        const restored = f.service.updatePage(child.id, { archived: false, expected_version: 3 }, f.member);
        assert.equal(restored.content, '新的项圈研究');
        assert.equal(f.service.exportSpace(s.id).pages.length, 2);
        assert.equal(f.service.createPage({ space_id: s.id, title: '幂等', request_id: 'same-request' }, f.member).id,
            f.service.createPage({ space_id: s.id, title: '幂等', request_id: 'same-request' }, f.member).id);
        assert.throws(() => f.service.createPage({ space_id: s.id, title: '不同正文', request_id: 'same-request' }, f.member), /重复请求/);
    } finally { f.close(); }
});

test('SOP becomes a portable local Skill, and bindings retain the selected snapshot after edits', () => {
    const f = fixture();
    try {
        const s = f.service.createSpace({ name: '组织方法' }, f.member);
        const p = f.service.createPage({ space_id: s.id, title: '需求评审 SOP', kind: 'sop', content: '# 步骤\n先核对来源，再评审。' }, f.member);
        const skill = f.service.skillFromPage(p.id, { expected_version: p.version, name: 'requirements-review', description: '评审需求时使用' }, f.member);
        assert.match(skill.content, /name: requirements-review/);
        assert.match(skill.content, /先核对来源/);
        assert.equal(skill.source_type, 'local');
        const agent = resources(f.db).save('agents', { name: '产品经理', content: '按组织方法工作' });
        f.service.bindAgent(agent.id, { skill_id: skill.id, expected_skill_version: skill.updated_at }, f.member);
        const flow = f.service.saveWorkflow(undefined, { name: '需求到交付', steps: [{ title: '评审', skill_id: skill.id, agent_id: agent.id }] }, f.member);
        skills(f.db).update(skill.id, { content: skill.content + '\n新增未采用步骤' }, f.member);
        const agentContext = f.service.agentContext(agent.id);
        assert.ok(!agentContext.skills[0].content.includes('新增未采用步骤'));
        assert.equal(agentContext.skills[0].update_available, true);
        const flowContext = f.service.workflowContext(flow.id);
        assert.equal(flowContext.execution_supported, false);
        assert.ok(!flowContext.steps[0].skill.content.includes('新增未采用步骤'));
        assert.equal(flowContext.steps[0].agent!.content, '按组织方法工作');
        const renamedFlow = f.service.saveWorkflow(flow.id, { name: '改名后流程', expected_version: flow.version, steps: [{ title: '评审与核对', skill_id: skill.id, agent_id: agent.id }] }, f.member);
        assert.ok(!renamedFlow.steps[0].skill.content.includes('新增未采用步骤'));
        assert.equal(f.service.exportSpace(s.id).skills[0].id, skill.id);
        assert.equal(f.service.exportSpace(s.id).workflows[0].workflow.name, '改名后流程');
        assert.throws(() => f.service.bindAgent(agent.id, { skill_id: skill.id, expected_skill_version: skill.updated_at }, f.member), /冲突/);
        assert.throws(() => f.service.skillFromPage(p.id, { expected_version: 99, name: 'stale', description: 'stale' }, f.member), /冲突/);
    } finally { f.close(); }
});

test('Attachments preserve original bytes and digests, reject invalid input, and appear in portable export', () => {
    const f = fixture();
    try {
        const s = f.service.createSpace({ name: '研究' }, f.member);
        const p = f.service.createPage({ space_id: s.id, title: '截图' }, f.member);
        const content = Buffer.from('%PDF-1.7\nsynthetic research');
        const a = f.service.addAttachment(p.id, { name: '调研.pdf', data: content.toString('base64') }, f.member);
        assert.equal(a.media_type, 'application/pdf');
        assert.equal(a.size, content.length);
        assert.deepEqual(f.service.attachment(a.id).bytes, content);
        assert.equal(f.service.addAttachment(p.id, { name: '调研.pdf', data: content.toString('base64') }, f.member).id, a.id);
        assert.throws(() => f.service.addAttachment(p.id, { name: '../escape', data: 'badbase64' }, f.member), /附件/);
        assert.equal(f.service.exportSpace(s.id).attachments[0].data, content.toString('base64'));
    } finally { f.close(); }
});
