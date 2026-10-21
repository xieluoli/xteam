import { test, expect, type BrowserContext } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const origin = process.env.PLAYWRIGHT_BASE_URL ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const apiOrigin = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;

async function authenticate(context: BrowserContext, token: string) {
  await context.addCookies([
    { name: "multica_auth", value: token, url: origin, httpOnly: true },
    { name: "multica_logged_in", value: "1", url: origin },
    { name: "multica-locale", value: "en", url: origin },
  ]);
  // Use the real local API with fixture credentials; no responses are mocked.
  await context.route((url) => ["localhost", "127.0.0.1"].includes(url.hostname) && [new URL(origin).port, new URL(apiOrigin).port].includes(url.port) && url.pathname.startsWith("/api/"), async (route) => {
    await route.continue({ headers: { ...route.request().headers(), Authorization: `Bearer ${token}` } });
  });
}

test("project context persists sources, preserves work items and is read-only for members", async ({ browser }, testInfo) => {
  const owner = new TestApiClient();
  const reader = new TestApiClient();
  const stamp = `${Date.now()}-${process.pid}`;
  await owner.login(`context-owner-${stamp}@example.test`, "Context owner");
  const workspace = await owner.ensureWorkspace("Context acceptance", `context-${stamp}`);
  await owner.markUserOnboarded();
  await reader.login(`context-reader-${stamp}@example.test`, "Context reader");
  await reader.markUserOnboarded();
  const memberId = await owner.addMemberByEmail(reader.getEmail());
  const project = await owner.createProject("Project context acceptance", { description: "Local fixture only" });
  await owner.createIssue("Existing project work item", { project_id: project.id });
  const ownerContext = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const readerContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ownerContext.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const projectPath = `/${workspace.slug}/projects/${project.id}`;
  try {
    await authenticate(ownerContext, owner.getToken()!);
    await page.goto(`${origin}${projectPath}`);
    await expect(page.getByRole("tab", { name: "Context", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Inbox", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "My Issues", exact: true })).toHaveCount(0);
    await expect(page.getByText("Organization library", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit context" }).click();
    await page.getByRole("button", { name: "Add entry document" }).click();
    const entry = page.locator("section").filter({ has: page.getByRole("heading", { name: "Read first" }) });
    await entry.getByLabel("Name", { exact: true }).fill("Project entry");
    await entry.getByLabel("Source location", { exact: true }).fill("https://example.com/AGENTS.md");
    await page.getByLabel("Reading instructions", { exact: true }).fill("Read the approved requirements before browsing implementation.");
    const requirements = page.getByRole("group", { name: "Requirements", exact: true });
    await requirements.getByRole("button", { name: "Add GitHub link" }).click();
    await requirements.getByLabel("Name", { exact: true }).fill("Approved product requirements");
    await requirements.getByLabel("Source location", { exact: true }).fill("https://user:secret@example.com/docs");
    await page.getByRole("button", { name: "Save context" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "credentials" })).toBeVisible();
    await expect(requirements.getByLabel("Name", { exact: true })).toHaveValue("Approved product requirements");
    const longLocation = `https://example.com/requirements/${"very-long-location-".repeat(12)}`;
    await requirements.getByLabel("Source location", { exact: true }).fill(longLocation);
    const lessons = page.getByRole("group", { name: "Project lessons", exact: true });
    await lessons.getByRole("button", { name: "Add reference" }).click();
    await lessons.getByLabel("Name", { exact: true }).fill("Local lessons");
    await lessons.getByRole("combobox", { name: "Source type", exact: true }).selectOption("path");
    await lessons.getByLabel("Source location", { exact: true }).fill("/workspace/product/LESSONS.md");
    await page.getByRole("group", { name: "Design system", exact: true }).getByLabel("Not applicable").check();
    // Verify labels/control columns and section headings do not overlap at either width.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("heading", { name: "Project context", exact: true }).scrollIntoViewIfNeeded();
      const overlaps = await page.locator("form").evaluate((form) => {
        const intersects = (left: Element, right: Element) => {
          const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect();
          return a.width > 0 && b.width > 0 && Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
        };
        return [...form.querySelectorAll("label[for]")].filter(label => {
          const control = document.getElementById(label.getAttribute("for")!);
          return control && intersects(label,control);
        }).map(label=>label.textContent);
      });
      expect(overlaps).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole("button", { name: "Save context" }).scrollIntoViewIfNeeded();
      const saveBar = page.getByRole("button", { name: "Save context" }).locator("..");
      const obscuredControls = await saveBar.evaluate((bar) => {
        const bounds = bar.getBoundingClientRect();
        return [...bar.closest("form")!.querySelectorAll("input,textarea,select")].filter(control => {
          const box = control.getBoundingClientRect();
          return Math.min(box.bottom,bounds.bottom)-Math.max(box.top,bounds.top)>1;
        }).length;
      });
      expect(obscuredControls).toBe(0);
      await page.getByRole("heading", { name: "Project context", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`context-edit-${width}.png`), animations: "disabled" });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Save context" }).click();
    await expect(page.getByRole("link", { name: "Approved product requirements" })).toHaveAttribute("href", longLocation);
    await page.reload();
    await expect(page.getByRole("link", { name: "Project entry" })).toBeVisible();
    await expect(page.getByText("Local lessons", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Local lessons" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("context-desktop.png"), animations: "disabled" });
    await page.getByRole("tab", { name: "Work items", exact: true }).click();
    await expect(page).toHaveURL(/section=work/);
    await expect(page.getByText("Existing project work item", { exact: true }).first()).toBeVisible();
    await page.goto(`${origin}${projectPath}?view=board`);
    await expect(page.getByRole("tab", { name: "Work items", exact: true })).toHaveAttribute("aria-selected", "true");
    await authenticate(readerContext, reader.getToken()!);
    const readerPage = await readerContext.newPage();
    await readerPage.goto(`${origin}${projectPath}`);
    await expect(readerPage.getByRole("link", { name: "Approved product requirements" })).toBeVisible();
    await expect(readerPage.getByRole("button", { name: "Edit context" })).toHaveCount(0);
    expect(await readerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await readerPage.screenshot({ path: testInfo.outputPath("context-mobile.png"), animations: "disabled" });
    const denied = await readerContext.request.put(`${apiOrigin}/api/projects/${project.id}/context`, {
      headers: { Authorization: `Bearer ${reader.getToken()}`, "X-Workspace-ID": workspace.id }, data: { revision: 1 },
    });
    expect(denied.status()).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    await ownerContext.close();
    await readerContext.close();
    await owner.cleanup();
    await owner.removeMember(memberId);
    await owner.deleteWorkspace();
  }
});
