# XTEAM

Independent MIT implementation of a single shared team resource space. Do not copy Multica source or introduce its packages.

- `server/`: Express, SQLite, authentication, shared resource service, MCP. Web and MCP must share the same resource rules.
- `web/`: React UI. Keep resource content as plain text; never execute templates or skills.
- `scripts/`: server-admin account management and consistent SQLite backup.
- `tests/`: Node integration tests and browser acceptance tests.
- `docs/`: approved scope, operations, and delivery evidence.

Run `pnpm test`, `pnpm build`, `pnpm test:e2e`. Tests use temporary databases and never production accounts. No real AI execution or paid model calls in default tests.

Keep secrets, data, local archives and credentials outside Git. Preserve old database volumes and Git history. Do not restore old routes/engines, add dependencies, deploy or push without authorization.

Use TDD for behavior changes. Follow the existing simple code style, clean up only code made obsolete by the change, and verify before reporting completion.
