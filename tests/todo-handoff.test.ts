import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHandoffTemplate } from '../shared/todo-handoff.js';

test('Continuation template only appends missing sections without rewriting notes or decisions', () => {
    const original = '设备甲备注\n## 已确认决定\n保留已有约定\n## 结果\n已验证本地；上线待验证';
    const result = appendHandoffTemplate(original);
    assert.ok(result.startsWith(original + '\n\n'));
    assert.equal(result.match(/## 已确认决定/g)?.length, 1);
    assert.equal(result.match(/## 结果/g)?.length, 1);
    assert.equal(appendHandoffTemplate(result), result);
    assert.equal(appendHandoffTemplate(''), '## 目标\n未填写\n\n## 已确认决定\n未填写\n\n## 约束\n未填写\n\n## 结果\n未填写\n\n## 证据\n未填写\n\n## 下一步\n未填写');
});
