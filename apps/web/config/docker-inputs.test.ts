// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const dockerfile = readFileSync(resolve(root, "Dockerfile.web"), "utf8");

describe("web-only Docker inputs", () => {
  it("includes the retained workspace manifests before the frozen install", () => {
    const deps = dockerfile.split("# --- Build ---")[0];
    for (const pkg of ["core", "ui", "views", "plugin-sdk", "tsconfig", "eslint-config"]) {
      expect(deps).toContain(`COPY packages/${pkg}/package.json packages/${pkg}/`);
    }
  });

  it("does not require mobile patch sources", () => {
    expect(dockerfile).not.toContain("apps/mobile");
    expect(readFileSync(resolve(root, ".dockerignore"), "utf8")).not.toContain("!/apps/mobile/");
  });
});
