import { openDatabase } from '../server/store.js';
const destination = process.argv[2];
if (!destination)
    throw new Error('用法: pnpm backup /安全目录/xteam.db');
const database = openDatabase(process.env.XTEAM_DATABASE ?? 'data/xteam.db');
try {
    await database.backup(destination);
    process.stdout.write('备份完成\n');
}
finally {
    database.close();
}
