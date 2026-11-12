import type Database from 'better-sqlite3';
import { knowledge } from './knowledge.js';
import { resources } from './resources.js';

const escape = (value: unknown) => String(value ?? '').replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ');
export function importLegacyProjects(db: Database.Database, actor: string) {
    return db.transaction(() => {
        const k = knowledge(db), r = resources(db);
        const results = [];
        for (const project of r.list('projects')) {
            const old = db.prepare('SELECT * FROM knowledge_project_imports WHERE project_id=?').get(project.id);
            if (old) { results.push(old); continue; }
            const context = r.context(project.id);
            const source = context.links.filter(l => !/\/pull\/\d+|\/releases\//.test(String(l.url)));
            const history = context.links.filter(l => /\/pull\/\d+|\/releases\//.test(String(l.url))).sort((a, b) => String(a.url).localeCompare(String(b.url), 'en', { numeric: true }));
            const s = k.createSpace({ name: String(project.name), description: String(project.description) }, actor);
            const overview = k.createPage({ space_id: s.id, title: '项目概览', content: `# ${escape(project.name)}\n\n${project.description || ''}\n\n## 资料入口\n\n${source.map(l => `- [${escape(l.title)}](${l.url})`).join('\n') || '待补充'}\n\n## 知识与方法\n\n将产品背景、调研和 SOP 整理为页面。可复用的 SOP 可保存为 Skill，绑定到工作流程或 Agent。\n\n旧开发任务的原编号、正文和历史保留在归档中；归档不代表未完成项已经验收。`, request_id: `legacy-overview-${project.id}` }, actor);
            const h = k.createPage({ space_id: s.id, title: '研发交付记录', content: '# 研发交付来源\n\n以下保留原有交付链接，具体完成范围以各条来源为准。\n\n' + (history.map(l => `- [${escape(l.title)}](${l.url})`).join('\n') || '暂无交付链接。'), request_id: `legacy-history-${project.id}` }, actor);
            db.prepare('INSERT INTO knowledge_project_imports VALUES (?,?,?,?)').run(project.id, s.id, overview.id, h.id);
            results.push({ project_id: project.id, space_id: s.id, overview_page_id: overview.id, history_page_id: h.id });
        }
        return results;
    }).immediate();
}
