import { beforeEach, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectContextSchema } from "@multica/core/projects";
import { renderWithI18n } from "../../test/i18n";
import { ProjectContextPanel } from "./project-context-panel";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), resources: vi.fn() }));
vi.mock("@multica/core/api", () => ({ api: { getProjectContext: mocks.get, listProjectResources: mocks.resources, updateProjectContext: mocks.update } }));
function renderPanel(canEdit = true) { return renderWithI18n(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ProjectContextPanel projectId="project" wsId="workspace" canEdit={canEdit}/></QueryClientProvider>); }
beforeEach(() => { mocks.get.mockResolvedValue(ProjectContextSchema.parse({ revision: 0 })); mocks.update.mockReset(); mocks.resources.mockResolvedValue({ resources: [], total: 0 }); });
it("adds a source, retains input after failed save, and shows a real external link after retry", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Edit context" }));
    await user.click(within(screen.getByRole("group", { name: "Requirements" })).getByRole("button", { name: "Add reference" }));
    await user.type(screen.getByLabelText("Name"), "Product rules");
    await user.type(screen.getByLabelText("Source location"), "https://example.com/docs");
    mocks.update.mockRejectedValueOnce(new Error("Save unavailable"));
    await user.click(screen.getByRole("button", { name: "Save context" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
    expect(screen.getByLabelText("Name")).toHaveValue("Product rules");
    mocks.update.mockImplementationOnce(async (_id, doc) => ({ ...doc, revision: 1 }));
    await user.click(screen.getByRole("button", { name: "Save context" }));
    expect(await screen.findByRole("link", { name: "Product rules" })).toHaveAttribute("href", "https://example.com/docs");
});
it("does not expose editing to read-only members or turn local paths into clickable links", async () => {
    mocks.get.mockResolvedValue(ProjectContextSchema.parse({ revision: 2, entrypoint: { name: "Local lessons", kind: "path", location: "/workspace/LESSONS.md" }, sections: { lessons: { not_applicable: true } } }));
    renderPanel(false);
    expect(await screen.findByText("Local lessons")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit context" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Local lessons" })).not.toBeInTheDocument();
    expect(screen.getByText("Not applicable")).toBeVisible();
});
it("selects an existing GitHub source and reorders or removes references before saving", async () => {
    mocks.resources.mockResolvedValue({ resources: [{ id: "repo", resource_type: "github_repo", resource_ref: { url: "https://github.com/example/product", ref: "main" }, label: "Product repository" }], total: 1 });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Edit context" }));
    const group = within(screen.getByRole("group", { name: "Code" }));
    await user.selectOptions(group.getByLabelText("Use existing repository"), "repo");
    await user.click(group.getByRole("button", { name: "Add reference" }));
    const names = group.getAllByLabelText("Name");
    await user.type(names[1]!, "Second source");
    const locations = group.getAllByLabelText("Source location");
    await user.type(locations[1]!, "https://example.com/second");
    await user.click(group.getAllByRole("button", { name: "Move up" })[1]!);
    expect(group.getAllByLabelText("Name")[0]).toHaveValue("Second source");
    await user.click(group.getAllByRole("button", { name: "Remove reference" })[1]!);
    expect(group.getAllByLabelText("Name")).toHaveLength(1);
    mocks.update.mockImplementationOnce(async (_id, doc) => ({ ...doc, revision: 1 }));
    await user.click(screen.getByRole("button", { name: "Save context" }));
    expect(await screen.findByRole("link", { name: "Second source" })).toHaveAttribute("href", "https://example.com/second");
});

it("offers GitHub additions in every section and saves removal without changing other sections", async () => {
  const user = userEvent.setup();
  renderPanel();
  await screen.findByRole("button", { name: "Edit context" });
  for (const category of ["Requirements", "Code", "Design system", "Project lessons"]) {
    const group = within(screen.getByRole("group", { name: category }));
    await user.click(group.getByRole("button", { name: "Add GitHub link" }));
    await user.type(group.getByLabelText("Name", { exact: true }), category);
    await user.clear(group.getByLabelText("Source location", { exact: true }));
    await user.type(group.getByLabelText("Source location", { exact: true }), "https://github.com/example/product");
  }
  mocks.update.mockImplementation(async (_id, doc) => ({ ...doc, revision: 1 }));
  await user.click(screen.getByRole("button", { name: "Save context" }));
  for (const category of ["Requirements", "Code", "Design system", "Project lessons"]) {
    expect(await within(screen.getByRole("group", { name: category })).findByRole("link", { name: category })).toHaveAttribute("href", "https://github.com/example/product");
  }
  await user.click(screen.getByRole("button", { name: "Edit context" }));
  await user.click(within(screen.getByRole("group", { name: "Code" })).getByRole("button", { name: "Remove reference" }));
  await user.click(screen.getByRole("button", { name: "Save context" }));
  expect(await within(screen.getByRole("group", { name: "Code" })).findByText("Not configured")).toBeVisible();
  expect(within(screen.getByRole("group", { name: "Requirements" })).getByRole("link", { name: "Requirements" })).toBeVisible();
});
