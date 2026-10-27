import { openDatabase, provisionUser, disableUser } from '../server/store.js';
const [action, email] = process.argv.slice(2);
if (!['set-password', 'disable'].includes(action) || !email)
    throw new Error('用法: pnpm admin set-password|disable email');
const database = openDatabase(process.env.XTEAM_DATABASE ?? 'data/xteam.db');
try {
    if (action === 'disable')
        disableUser(database, email);
    else {
        if (!process.stdin.isTTY)
            throw new Error('密码必须从交互终端输入');
        const terminal = process.stdin;
        process.stdout.write('新密码（至少 12 位，输入不可见）: ');
        const previousRaw = terminal.isRaw;
        terminal.setRawMode(true);
        terminal.resume();
        terminal.setEncoding('utf8');
        const password = await new Promise<string>((resolve, reject) => {
            let value = '';
            const listener = (chunk: string) => {
                for (const character of chunk) {
                    if (character.charCodeAt(0) === 3) {
                        cleanup();
                        reject(new Error('已取消'));
                        return;
                    }
                    if (character === '\r' || character === '\n') {
                        cleanup();
                        resolve(value);
                        return;
                    }
                    if (character.charCodeAt(0) === 127)
                        value = value.slice(0, -1);
                    else
                        value += character;
                }
            };
            function cleanup() { terminal.off('data', listener); terminal.setRawMode(previousRaw); terminal.pause(); process.stdout.write('\n'); }
            terminal.on('data', listener);
        });
        provisionUser(database, email, password);
    }
    process.stdout.write('账号已更新\n');
}
finally {
    database.close();
}
