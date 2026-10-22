// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

it("rejects malformed key listings instead of presenting empty successful data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: "broken" }))));
  await expect(new ApiClient("https://example.test").listMCPKeys()).rejects.toThrow();
});

it("requires the one-time secret in a create response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "id", scopes: [] }))));
  await expect(new ApiClient("https://example.test").createMCPKey({
    name: "test", workspace_id: "ws", scopes: ["issues:read"], expires_in_days: 30,
  })).rejects.toThrow();
});
