import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  radiusViolations,
} from "./check-ui-radius-tokens.mjs";

const probe = resolve("packages/views/zz-radius-probe.tsx");

test("rejects bare radius utilities, including directions, variants, and templates", () => {
  const source = `
    const plain = "rounded border";
    const variant = \`hover:rounded data-open:rounded-t \${active ? "rounded-bl" : ""}\`;
  `;
  assert.deepEqual(
    radiusViolations(source, probe).map((finding) => finding.token),
    ["rounded", "hover:rounded", "data-open:rounded-t", "rounded-bl"],
  );
});

test("rejects fixed arbitrary product radii regardless of CSS unit", () => {
  const findings = radiusViolations(
    `const classes = "rounded-[4px] data-open:rounded-t-[0.75rem] rounded-b-[1em]";`,
    probe,
  );
  assert.deepEqual(
    findings.map((finding) => finding.token),
    ["rounded-[4px]", "data-open:rounded-t-[0.75rem]", "rounded-b-[1em]"],
  );
});

test("accepts named, computed, and explicitly allowlisted micro-geometry", () => {
  assert.equal(
    radiusViolations(
      `const classes = "rounded-xs rounded-lg rounded-[calc(var(--radius)-3px)]";`,
      probe,
    ).length,
    0,
  );
  assert.equal(
    radiusViolations(
      `const mark = "rounded-[2px]";`,
      resolve("packages/ui/components/ui/chart.tsx"),
    ).length,
    0,
  );
});

test("the CLI checks web surfaces without native apps and still rejects radius drift", (t) => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "web-radius-")));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const directory of ["scripts", "apps/web", "packages/ui", "packages/views"]) {
    mkdirSync(join(fixture, directory), { recursive: true });
  }
  symlinkSync(resolve("node_modules"), join(fixture, "node_modules"), "dir");
  const script = join(fixture, "scripts/check-ui-radius-tokens.mjs");
  writeFileSync(script, readFileSync(new URL("./check-ui-radius-tokens.mjs", import.meta.url)));
  const probe = join(fixture, "apps/web/probe.tsx");
  writeFileSync(probe, 'const classes = "rounded-lg";');
  const clean = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stderr);
  writeFileSync(probe, 'const classes = "rounded";');
  const drift = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /Un-tokenized product radius/);
  assert.match(drift.stderr, /apps\/web\/probe.tsx/);
});
