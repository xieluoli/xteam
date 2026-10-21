// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

it("rejects malformed context instead of making it look like an empty saved document", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: "broken", sections: [] }))));
  await expect(new ApiClient("https://example.test").getProjectContext("project")).rejects.toThrow();
});

it("normalizes omitted optional sections without dropping the revision", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 3, reading_notes: "Read first" }))));
  const document = await new ApiClient("https://example.test").getProjectContext("project");
  expect(document.sections.lessons).toEqual({ not_applicable: false, references: [] });
  expect(document.revision).toBe(3);
});

it("does not report a malformed save response as a successful empty context", async () => {
  const client = new ApiClient("https://example.test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 0 }))));
  const document = await client.getProjectContext("project");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: null }))));
  await expect(client.updateProjectContext("project", document)).rejects.toThrow("Malformed project context response");
});
