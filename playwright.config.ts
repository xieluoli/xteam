import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', use: { baseURL: 'http://127.0.0.1:3199', browserName: 'chromium', screenshot: 'only-on-failure' }, webServer: { command: 'pnpm build && pnpm exec tsx tests/serve.ts', url: 'http://127.0.0.1:3199/health', reuseExistingServer: false }, workers: 1 });
