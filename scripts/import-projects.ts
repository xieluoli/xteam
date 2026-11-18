import { openDatabase } from '../server/store.js';
import { importLegacyProjects } from '../server/knowledge-import.js';
const db = openDatabase(process.env.XTEAM_DATABASE ?? 'data/xteam.db');
try {
    const member = db.prepare('SELECT id FROM users WHERE enabled=1 ORDER BY id LIMIT 1').get() as { id: string } | undefined;
    if (!member) throw new Error('需要既有有效成员，未创建或重置账号');
    console.log(JSON.stringify({ imported: importLegacyProjects(db, member.id) }));
} finally { db.close(); }
