import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { api } from "@multica/core/api";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { AgentsPage } from "./agents-page";

vi.mock("@multica/core/api", () => ({
  api: {
    getBaseUrl: () => "",
    listAgents: vi.fn(),
    listMembers: vi.fn(),
    listAgentMcpServers: vi.fn(),
  },
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    newAgent: () => "/neo/agents/new",
    agentDetail: (id: string) => `/neo/agents/${id}`,
  }),
}));
const DEMO: Agent = {
  id: "pm-demo-id", workspace_id: "workspace-1", runtime_id: "",
  runtime_bound: false, name: "pm-demo", description: "Reusable product workflow",
  instructions: "Product instructions", avatar_url: "emoji:🚀", runtime_mode: "local",
  runtime_config: {}, custom_args: [], visibility: "workspace", permission_mode: "public_to",
  invocation_targets: [], status: "offline", max_concurrent_tasks: 1, model: "",
  owner_id: "user-1", skills: [{ id: "skill-1", name: "pmspec-explore", description: "Explore", enabled: true }],
  mcp_config: { mcpServers: { documentation: { url: "https://private.invalid", headers: { Authorization: "secret-token" } } } },
  created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
  archived_at: null, archived_by: null,
};
const AUTHOR: MemberWithUser = {
  id: "member-1", workspace_id: "workspace-1", user_id: "user-1", role: "owner",
  created_at: "2026-10-15T00:00:00Z", name: "Template author", email: "private@example.invalid", avatar_url: null,
};

function renderPage(locale: "en" | "zh-Hans" = "en", pmInstallRelease?: import("./pm-install-dialog").PmInstallRelease) {
  const navigation: NavigationAdapter = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/neo/agents",
    searchParams: new URLSearchParams(), hash: "", getShareableUrl: (path) => path,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  renderWithI18n(
    <QueryClientProvider client={client}>
      <NavigationProvider value={navigation}><AgentsPage pmInstallRelease={pmInstallRelease} /></NavigationProvider>
    </QueryClientProvider>, { locale },
  );
  return navigation;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listAgents).mockResolvedValue([DEMO]);
  vi.mocked(api.listMembers).mockResolvedValue([AUTHOR]);
  vi.mocked(api.listAgentMcpServers).mockResolvedValue([
    { id: "mcp-1", workspace_id: "workspace-1", name: "Team knowledge", transport: "http", enabled: true, created_at: "", updated_at: "" },
  ]);
});

describe("Agent template marketplace", () => {
  it("pins the built-in Mika before ordinary templates and credits Multica", async () => {
    vi.mocked(api.listAgents).mockResolvedValue([
      { ...DEMO, id: "ordinary-mika", name: "Mika" },
      { ...DEMO, id: "alpha", name: "Alpha" },
      DEMO,
      { ...DEMO, id: "builtin-mika", name: "Workspace helper", system_key: "mika", avatar_url: "emoji:🦄" },
    ]);
    renderPage();
    const builtin = await screen.findByRole("article", { name: "Workspace helper" });
    expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual([
      "Workspace helper", "Alpha", "Mika", "pm-demo",
    ]);
    expect(within(builtin).getByText("Multica built-in")).toBeVisible();
    expect(within(builtin).getByText("Multica")).toBeVisible();
    expect(within(builtin).queryByText("Template author")).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Mika" })).queryByText("Multica built-in")).not.toBeInTheDocument();
    expect(within(builtin).getByRole("link")).toHaveAttribute("href", "/neo/agents/builtin-mika");
  });

  it("keeps Mika subject to search instead of forcing an unrelated pinned result", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgents).mockResolvedValue([
      DEMO, { ...DEMO, id: "builtin-mika", name: "Mika", description: "Workspace coordination", skills: [], system_key: "mika" },
    ]);
    renderPage("zh-Hans");
    const builtin = await screen.findByRole("article", { name: "Mika" });
    expect(within(builtin).getByText("Multica 内置")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "搜索模板" }), "pm-demo");
    expect(screen.queryByRole("article", { name: "Mika" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "pm-demo" })).toBeInTheDocument();
  });

  it("copies a fixed Codex install entry only for the matching published PM snapshot", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgents).mockResolvedValue([{ ...DEMO, mcp_config: null }]);
    vi.mocked(api.listAgentMcpServers).mockResolvedValue([]);
    renderPage("en", {
      url: "https://github.com/xieluoli/xteam/releases/download/pm-test/pm-demo.tar.gz",
      sha256: "a".repeat(64), version: "snapshot-test", instructions: "Product instructions",
      skillNames: ["pmspec-explore"],
    });
    await screen.findByRole("button", { name: "Copy" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Copy" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Install PM in Codex");
    const instructions = within(dialog).getByRole("textbox", { name: "Installation instructions" });
    expect(instructions).toHaveProperty("value", expect.stringContaining("https://github.com/xieluoli/xteam/releases/download/pm-test/pm-demo.tar.gz"));
    await user.click(within(dialog).getByRole("button", { name: "Copy instructions" }));
    expect(await navigator.clipboard.readText()).toContain("snapshot-test");
    expect(await navigator.clipboard.readText()).toContain("--check");
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Copied");
  });

  it("keeps the installation instructions available when clipboard permission is denied", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgents).mockResolvedValue([{ ...DEMO, mcp_config: null }]);
    vi.mocked(api.listAgentMcpServers).mockResolvedValue([]);
    renderPage("en", {
      url: "https://github.com/xieluoli/xteam/releases/download/pm-test/pm-demo.tar.gz",
      sha256: "a".repeat(64), version: "snapshot-test", instructions: "Product instructions", skillNames: ["pmspec-explore"],
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Copy" }));
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("permission denied"));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Copy instructions" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Select and copy");
    expect(within(dialog).getByRole("textbox", { name: "Installation instructions" })).toBeVisible();
  });

  it("does not export edited or MCP-configured templates as the public PM release", async () => {
    vi.mocked(api.listAgents).mockResolvedValue([{ ...DEMO, instructions: "Private company instructions" }]);
    renderPage("en", {
      url: "https://github.com/xieluoli/xteam/releases/download/pm-test/pm-demo.tar.gz",
      sha256: "a".repeat(64), version: "snapshot-test", instructions: "Product instructions", skillNames: ["pmspec-explore"],
    });
    expect(await screen.findByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("shows unbound templates immediately with identity, references and author, not execution metrics", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "pm-demo" });
    expect(within(card).getByText("🚀")).toBeInTheDocument();
    expect(within(card).getByText("Reusable product workflow")).toBeInTheDocument();
    expect(within(card).getByText("pmspec-explore")).toBeInTheDocument();
    expect(await within(card).findByText("Team knowledge")).toBeInTheDocument();
    expect(within(card).getByText("documentation")).toBeInTheDocument();
    expect(await within(card).findByText("Template author")).toBeInTheDocument();
    expect(screen.queryByText("private@example.invalid")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("secret-token");
    expect(card).not.toHaveTextContent("https://private.invalid");
    expect(screen.queryByText("Needs runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("Last active")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows only the accessible Copy icon without a coming-soon message or navigation", async () => {
    const user = userEvent.setup();
    const navigation = renderPage();
    const card = await screen.findByRole("article", { name: "pm-demo" });
    const copy = within(card).getByRole("button", { name: "Copy" });
    expect(copy).toBeDisabled();
    expect(copy).toHaveTextContent(/^$/);
    expect(within(card).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(copy.querySelector("svg")).not.toBeNull();
    await user.click(copy);
    expect(navigation.push).not.toHaveBeenCalled();
    const link = within(card).getByRole("link", { name: "View template pm-demo" });
    expect(link).toHaveAttribute("href", "/neo/agents/pm-demo-id");
    await user.click(link);
    expect(navigation.push).toHaveBeenCalledWith("/neo/agents/pm-demo-id");
  });

  it("searches templates without showing archived entries or sorting by runtime activity", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgents).mockResolvedValue([
      { ...DEMO, id: "zulu", name: "Zulu", description: "Other workflow" }, DEMO,
      { ...DEMO, id: "archived", name: "Archived", archived_at: "2026-10-15T00:00:00Z" },
    ]);
    renderPage();
    await screen.findByRole("article", { name: "pm-demo" });
    expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(["pm-demo", "Zulu"]);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: "Search templates" });
    await user.type(search, "product");
    expect(screen.queryByRole("article", { name: "Zulu" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "pm-demo" })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "not-present");
    expect(screen.getByText("No matching templates")).toBeVisible();
  });

  it("distinguishes unavailable MCP metadata from no references and allows retry", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentMcpServers).mockRejectedValueOnce(new Error("unavailable"));
    vi.mocked(api.listAgents).mockResolvedValue([{ ...DEMO, mcp_config: null }]);
    renderPage();
    const card = await screen.findByRole("article", { name: "pm-demo" });
    expect(await within(card).findByText("Couldn't load MCP references")).toBeVisible();
    expect(within(card).queryByText("No MCP references")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await within(card).findByText("Team knowledge")).toBeVisible();
  });

  it("does not report redacted MCP configuration as empty", async () => {
    vi.mocked(api.listAgents).mockResolvedValue([{ ...DEMO, mcp_config: null, mcp_config_redacted: true }]);
    vi.mocked(api.listAgentMcpServers).mockResolvedValue([]);
    renderPage();
    const card = await screen.findByRole("article", { name: "pm-demo" });
    expect(await within(card).findByText("Additional MCP configuration is private")).toBeVisible();
    expect(within(card).queryByText("No MCP references")).not.toBeInTheDocument();
  });

  it("renders honest empty references and unknown authors in Chinese", async () => {
    vi.mocked(api.listAgents).mockResolvedValue([{ ...DEMO, avatar_url: null, skills: [], mcp_config: null }]);
    vi.mocked(api.listMembers).mockResolvedValue([]);
    vi.mocked(api.listAgentMcpServers).mockResolvedValue([]);
    renderPage("zh-Hans");
    const card = await screen.findByRole("article", { name: "pm-demo" });
    expect(within(card).getByText("🤖")).toBeInTheDocument();
    expect(within(card).getByText("未引用技能")).toBeVisible();
    expect(await within(card).findByText("未引用 MCP")).toBeVisible();
    expect(within(card).getByText("未知作者")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("shows a recoverable list error instead of a false empty market", async () => {
    vi.mocked(api.listAgents).mockRejectedValue(new Error("List unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("List unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByText("No templates yet")).not.toBeInTheDocument();
  });

  it("shows the empty market without requiring a runtime", async () => {
    vi.mocked(api.listAgents).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No templates yet")).toBeVisible();
  });
});
