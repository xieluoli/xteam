export type Experience = { project_id: string; todo_id: string; status: '待确认' | '已确认'; at: string; experience: string; applicability: string; verification: string; note: string };
const marker = '## 任务经验记录';
const quote = (value: string) => value.split('\n').map(line => '> ' + line).join('\n');
const unquote = (value: string) => value.split('\n').map(line => line.slice(2)).join('\n');
export function experienceText(record: Experience) {
    return [marker, `来源项目：${record.project_id}`, `来源任务：${record.todo_id}`, `状态：${record.status}`, `记录时间：${record.at}`, '### 经验', quote(record.experience), '### 适用条件', quote(record.applicability), '### 验证结果', quote(record.verification), '### 确认或修订说明', quote(record.note)].join('\n');
}
export function readExperiences(description: string, projectId: string, todoId: string): Experience[] {
    const blocks = description.split(/(?:^|\n)## 任务经验记录(?:\n|$)/).slice(1);
    return blocks.map(block => {
        const match = block.match(/^来源项目：([^\n]+)\n来源任务：([^\n]+)\n状态：(待确认|已确认)\n记录时间：([^\n]+)\n### 经验\n((?:> [^\n]*(?:\n|$))+)### 适用条件\n((?:> [^\n]*(?:\n|$))+)### 验证结果\n((?:> [^\n]*(?:\n|$))+)### 确认或修订说明\n((?:> [^\n]*(?:\n|$))+)/);
        if (!match) throw new Error('经验记录格式不完整，请先核对原文，避免覆盖手工修改。');
        if (match[1] !== projectId || match[2] !== todoId) throw new Error('经验来源与当前项目或任务不一致，请核对原文。');
        const field = (value: string) => unquote(value.replace(/\n$/, ''));
        return { project_id: match[1], todo_id: match[2], status: match[3] as Experience['status'], at: match[4], experience: field(match[5]), applicability: field(match[6]), verification: field(match[7]), note: field(match[8]) };
    });
}
