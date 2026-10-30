# XTEAM

Independent MIT implementation of a single shared team resource space. Do not copy Multica source or introduce its packages.

- `server/`: Express, SQLite, authentication, shared resource service, MCP. Web and MCP must share the same resource rules.
- `web/`: React UI. Keep resource content as plain text; never execute templates or skills.
- `scripts/`: server-admin account management and consistent SQLite backup.
- `tests/`: Node integration tests and browser acceptance tests.
- `docs/`: approved scope, operations, and delivery evidence.
- `doc/`: shared task status, daily plans/reviews, lessons, and agent handoff. Start with [doc/task.md](doc/task.md), then read [workflow](doc/workflow.md), [handoff](doc/handoff.md), [lessons](doc/lessons.md), and [standards](doc/code-standards.md).

Before continuing a task, fetch and inspect the remote status, check its stable task ID and owner, and preserve other devices' notes. Update the day's task and current entry before handing off; distinguish local development, pushed code, merged changes, platform sync, and online acceptance. Sync approved documentation through a branch/PR. Local locks do not coordinate different devices; coordinate existing task claims first. Keep raw evidence, device paths, runtime configuration and personal memory outside Git.

Git/GitHub operations use `git` and `gh` CLI only; check `gh auth status` first. PR changes use one concise Chinese bullet per change, with tests separate; use a temporary UTF-8 Markdown file and `--body-file`. Do not include local raw evidence in public PRs.

Run `pnpm test`, `pnpm build`, `pnpm test:e2e`. Tests use temporary databases and never production accounts. No real AI execution or paid model calls in default tests.

Keep secrets, data, local archives and credentials outside Git. Preserve old database volumes and Git history. Do not restore old routes/engines, add dependencies, deploy or push without authorization.

Use TDD for behavior changes. Follow the existing simple code style, clean up only code made obsolete by the change, and verify before reporting completion.

UI: Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
