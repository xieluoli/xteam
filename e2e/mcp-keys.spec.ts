import { test, expect } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const origin = process.env.PLAYWRIGHT_BASE_URL ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

test("creates a scoped key from settings, calls real MCP and revokes an existing client", async ({ browser }, testInfo) => {
  const api = new TestApiClient();
  const stamp = Date.now();
  await api.login(`mcp-e2e-${stamp}@example.test`, "MCP acceptance");
  const workspace = await api.ensureWorkspace("MCP acceptance", `mcp-${stamp}`);
  await api.markUserOnboarded();
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    { name: "multica_auth", value: api.getToken()!, url: origin, httpOnly: true },
    { name: "multica_logged_in", value: "1", url: origin },
    { name: "multica-locale", value: "en", url: origin },
  ]);
  // Authenticate fixture requests with the native bearer path; the UI and API
  // responses remain real. Ordinary cookie login is verified separately.
  await context.route(`${origin}/api/**`, async route => route.continue({ headers: { ...route.request().headers(), Authorization: `Bearer ${api.getToken()}` } }));
  const page = await context.newPage();
  let keyId: string | undefined;
  let issueId: string | undefined;
  try {
    await page.goto(`${origin}/${workspace.slug}/settings?tab=tokens`);
    await page.getByLabel("Key name", { exact: true }).fill("Codex acceptance");
    await page.getByLabel("Workspace", { exact: true }).selectOption(workspace.id);
    await page.getByLabel("Create and update issues", { exact: true }).check();
    await page.getByLabel("Delete issues", { exact: true }).check();
    const saved = page.waitForResponse(response => response.url().includes("/api/mcp-keys") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create MCP key", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const key = await response.json();
    keyId = key.id;
    await expect(page.getByText(key.token, { exact: true })).toBeVisible();
    const configuration = await page.locator("pre").filter({ hasText: "mcp_servers.xteam" }).innerText();
    expect(configuration).toContain(`url = "${origin}/mcp"`);
    expect(configuration).toContain('bearer_token_env_var = "XTEAM_MCP_KEY"');
    expect(configuration).not.toContain(key.token);
    await page.getByRole("button", { name: "I stored the key", exact: true }).click();
    await expect(page.getByText(key.token, { exact: true })).toHaveCount(0);
    const rpc = async (method: string, params: unknown) => {
      const result = await context.request.post(`${origin}/mcp`, {
        headers: { Authorization: `Bearer ${key.token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        data: { jsonrpc: "2.0", id: 1, method, params },
      });
      expect(result.status()).toBe(200);
      return (await result.json()).result;
    };
    const tool = async (name: string, args: Record<string, unknown>) => {
      const result = await rpc("tools/call", { name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse(result.content[0].text);
    };
    expect((await rpc("tools/list", {})).tools).toHaveLength(7);
    expect((await tool("xteam_identity", {})).workspace_id).toBe(workspace.id);
    const input = { request_id: `e2e-${stamp}`, title: `MCP acceptance ${stamp}` };
    const issue = await tool("xteam_issue_create", input);
    issueId = issue.id;
    expect((await tool("xteam_issue_create", input)).id).toBe(issue.id);
    expect((await tool("xteam_issue_update", { id: issue.identifier, changes: { priority: "high" } })).priority).toBe("high");
    expect((await tool("xteam_issue_get", { id: issue.id })).priority).toBe("high");
    await tool("xteam_issue_delete", { id: issue.id, confirmed: true });
    issueId = undefined;
    await page.reload();
    await expect(page.getByText(key.token, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Revoke Codex acceptance", exact: true }).click();
    await page.getByRole("button", { name: "Confirm revocation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Revoke Codex acceptance", exact: true })).toHaveCount(0);
    const denied = await context.request.post(`${origin}/mcp`, { headers: { Authorization: `Bearer ${key.token}` }, data: {} });
    expect(denied.status()).toBe(401);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByText("MCP keys", { exact: true }).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`mcp-keys-${width}.png`) });
    }
  } finally {
    await context.close();
    if (issueId) await api.deleteIssue(issueId);
    if (keyId) await api.revokeMCPKey(keyId);
    await api.cleanup();
    await api.deleteWorkspace();
  }
});
