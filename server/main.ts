import { createApp } from './app.js';
const origin = process.env.XTEAM_ORIGIN ?? 'http://localhost:3100';
const app = createApp({ database: process.env.XTEAM_DATABASE ?? 'data/xteam.db', origin, secure: origin.startsWith('https:') });
const server = app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');
function stop() { server.close(() => { app.locals.database.close(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
