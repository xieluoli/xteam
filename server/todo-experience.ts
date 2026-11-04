import type Database from 'better-sqlite3';
import { z } from 'zod';
import { resources, ResourceError } from './resources.js';
import { experienceText, readExperiences, type Experience } from '../shared/todo-experience.js';
export const experienceSchema = z.object({ action: z.enum(['submit', 'confirm', 'revise']), expected_updated_at: z.string().min(1).max(100), experience: z.string().trim().min(1).max(10000).optional(), applicability: z.string().trim().min(1).max(10000).optional(), verification: z.string().trim().min(1).max(10000).optional(), note: z.string().trim().min(1).max(5000).optional() });
export function todoExperiences(database: Database.Database) {
    const service = resources(database);
    function get(projectId: string, id: string) {
        const todo = service.get('todos', id);
        if (todo.project_id !== projectId) throw new ResourceError('Todo 不属于此项目', 404);
        try { return { todo, records: readExperiences(String(todo.description), projectId, id) }; }
        catch (error) { throw new ResourceError((error as Error).message, 422); }
    }
    function record(projectId: string, id: string, input: unknown) {
        const parsed = experienceSchema.safeParse(input);
        if (!parsed.success) throw new ResourceError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'));
        const data = parsed.data;
        return database.transaction(() => {
            const { todo, records } = get(projectId, id);
            if (todo.updated_at !== data.expected_updated_at) throw new ResourceError('资源已被其他设备修改，请重新读取并合并后重试；当前草稿尚未保存。', 409);
            const latest = records.at(-1);
            if (data.action === 'submit' && latest) throw new ResourceError('此任务已有经验，请核对已有经验并使用修订。', 409);
            if (data.action !== 'submit' && !latest) throw new ResourceError('请先提交经验，再确认或修订。', 409);
            if (data.action === 'confirm' && latest?.status === '已确认') throw new ResourceError('当前经验已确认；内容变化请使用修订。', 409);
            if (data.action !== 'submit' && !data.note) throw new ResourceError('请填写确认或修订说明。');
            if (data.action !== 'confirm' && (!data.experience || !data.applicability || !data.verification)) throw new ResourceError('经验、适用条件和验证结果均必填。');
            const entry: Experience = { project_id: projectId, todo_id: id, status: data.action === 'confirm' ? '已确认' : '待确认', at: new Date().toISOString(), experience: data.action === 'confirm' ? latest!.experience : data.experience!, applicability: data.action === 'confirm' ? latest!.applicability : data.applicability!, verification: data.action === 'confirm' ? latest!.verification : data.verification!, note: data.note || '首次提交，等待明确确认。' };
            return service.update('todos', id, { description: [todo.description, experienceText(entry)].filter(Boolean).join('\n\n'), expected_updated_at: data.expected_updated_at });
        }).immediate();
    }
    return { get, record };
}
