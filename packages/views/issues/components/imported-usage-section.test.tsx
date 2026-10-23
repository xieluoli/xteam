// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/i18n";
import { ImportedUsageSection } from "./imported-usage-section";

const listUsage = vi.fn();
vi.mock("@multica/core/api", () => ({ api: { listIssueImportedUsage: (...args: unknown[]) => listUsage(...args) } }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("shows source-tagged historical tokens separately with unknown coverage", async () => {
  listUsage.mockResolvedValue([{
    source_workspace_id: "origin", source_issue_id: "old", source_issue_identifier: "OLD-1", source_name: "Origin",
    captured_at: "2026-10-23T08:00:00Z", input_tokens: 120, output_tokens: 30, cache_read_tokens: 500, cache_write_tokens: 0,
    task_count: 2, coverage: null,
  }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithI18n(<QueryClientProvider client={client}><ImportedUsageSection issueId="issue" /></QueryClientProvider>);
  expect(await screen.findByText("Origin · OLD-1")).toBeTruthy();
  expect(screen.getByText("120")).toBeTruthy();
  expect(screen.getByText("500")).toBeTruthy();
  expect(screen.getByText(/coverage.*unknown/i)).toBeTruthy();
  expect(screen.getByText(/not.*local execution/i)).toBeTruthy();
});

it("does not present a failed load as zero historical consumption", async () => {
  listUsage.mockRejectedValue(new Error("offline"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithI18n(<QueryClientProvider client={client}><ImportedUsageSection issueId="issue" /></QueryClientProvider>);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not load historical token usage.");
});
