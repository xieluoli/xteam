// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());
it("reads historical usage without converting unknown coverage into zero", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    source_workspace_id: "source", source_issue_id: "old", source_issue_identifier: "OLD-1", source_name: "Origin",
    captured_at: "2026-10-23T08:00:00Z", input_tokens: 120, output_tokens: 30, cache_read_tokens: 500, cache_write_tokens: 0, task_count: 2,
  }]))));
  const result = await new ApiClient("https://example.test").listIssueImportedUsage("issue");
  expect(result[0]?.input_tokens).toBe(120);
  expect(result[0]?.coverage).toBeNull();
});
it("rejects malformed historical summaries rather than showing zero consumption", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{input_tokens: -1}]))));
  await expect(new ApiClient("https://example.test").listIssueImportedUsage("issue")).rejects.toThrow();
});
