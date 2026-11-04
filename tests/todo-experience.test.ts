import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/store.js';
import { resources } from '../server/resources.js';
import { todoExperiences } from '../server/todo-experience.js';
import { readExperiences } from '../shared/todo-experience.js';

test('Experience submission, confirmation and revision retain original text and source with guarded writes', () => {
    const db = openDatabase(':memory:');
    try {
        const service = resources(db), experiences = todoExperiences(db);
        const project = service.save('projects', { name: 'experience' });
        const other = service.save('projects', { name: 'other' });
        const original = '设备甲备注\n<script>只作文本</script>';
        const todo = service.save('todos', { project_id: project.id, title: '原任务', description: original, completed: true });
        const input = { action: 'submit', experience: '<script>经验正文</script>\n## 任务经验记录', applicability: 'SQLite 写入', verification: '两个独立客户端回归通过', expected_updated_at: todo.updated_at };
        assert.throws(() => experiences.record(other.id, todo.id, input), /不属于/);
        assert.throws(() => experiences.record(project.id, todo.id, { ...input, expected_updated_at: undefined }), /expected_updated_at/);
        const submitted = experiences.record(project.id, todo.id, input);
        assert.ok(String(submitted.description).startsWith(original + '\n\n'));
        let records = experiences.get(project.id, todo.id).records;
        assert.equal(records.length, 1); assert.equal(records[0].status, '待确认');
        assert.equal(records[0].experience, input.experience); assert.equal(records[0].project_id, project.id); assert.equal(records[0].todo_id, todo.id);
        assert.throws(() => experiences.record(project.id, todo.id, { ...input, expected_updated_at: submitted.updated_at }), /已有经验/);
        assert.throws(() => experiences.record(project.id, todo.id, { action: 'confirm', note: '回归复核', expected_updated_at: todo.updated_at }), /其他设备修改/);
        assert.throws(() => experiences.record(project.id, todo.id, { action: 'confirm', expected_updated_at: submitted.updated_at }), /说明/);
        const confirmed = experiences.record(project.id, todo.id, { action: 'confirm', note: '依据独立回归结果确认', expected_updated_at: submitted.updated_at });
        records = readExperiences(String(confirmed.description), project.id, todo.id);
        assert.equal(records.length, 2); assert.equal(records[0].status, '待确认'); assert.equal(records[1].status, '已确认');
        assert.equal(records[1].note, '依据独立回归结果确认');
        assert.throws(() => experiences.record(project.id, todo.id, { action: 'confirm', note: '再次确认', expected_updated_at: confirmed.updated_at }), /已确认/);
        const revised = experiences.record(project.id, todo.id, { ...input, action: 'revise', experience: '修订后的经验', note: '补充适用边界', expected_updated_at: confirmed.updated_at });
        records = readExperiences(String(revised.description), project.id, todo.id);
        assert.equal(records.length, 3); assert.equal(records[2].status, '待确认'); assert.equal(records[1].status, '已确认');
        assert.equal(revised.completed, true); assert.ok(String(revised.description).includes(original));
        service.update('todos', todo.id, { description: String(revised.description).replace('来源项目：' + project.id, '来源项目：' + other.id) });
        assert.throws(() => experiences.get(project.id, todo.id), /来源/);
    } finally { db.close(); }
});

test('Malformed experience text and description limit fail without losing saved content', () => {
    const db = openDatabase(':memory:');
    try {
        const service = resources(db), experiences = todoExperiences(db);
        const project = service.save('projects', { name: 'limit' });
        const todo = service.save('todos', { project_id: project.id, title: 'limit', description: 'a'.repeat(49900) });
        assert.throws(() => experiences.record(project.id, todo.id, { action: 'submit', experience: '内容', applicability: '条件', verification: '结果', expected_updated_at: todo.updated_at }), /50000/);
        assert.equal(service.get('todos', todo.id).description, todo.description);
        const invalid = service.update('todos', todo.id, { description: '原文\n## 任务经验记录\n不完整的手工修改' });
        assert.throws(() => experiences.record(project.id, todo.id, { action: 'submit', experience: '内容', applicability: '条件', verification: '结果', expected_updated_at: invalid.updated_at }), /记录格式/);
        assert.equal(service.get('todos', todo.id).description, invalid.description);
        assert.throws(() => readExperiences('原文\n## 任务经验记录', project.id, todo.id), /记录格式/);
    } finally { db.close(); }
});
