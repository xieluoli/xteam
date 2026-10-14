// @vitest-environment node
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = new URL("./japan-blues.css", import.meta.url);

describe("Japan Blues web palette", () => {
  it("loads an opt-in stylesheet without replacing shared defaults", () => {
    expect(readFileSync(new URL("./globals.css", import.meta.url), "utf8")).toContain('@import "./japan-blues.css"');
    expect(existsSync(stylesheet)).toBe(true);
    const css = readFileSync(stylesheet, "utf8");
    expect(css).toContain("html.japan-blues");
    expect(css).not.toContain(":root");
    expect(css).not.toContain("#oklch");
    expect(css).toContain("--app-shell: var(--sidebar)");
    expect(css).toContain("--page-canvas: var(--background)");
    expect(css).toContain("--primary-foreground: oklch(0.3250 0.0440 257.2870)");
  });
});
