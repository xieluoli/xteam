import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import type { Workspace } from "@multica/core/types";
import { useWelcomeStore } from "@multica/core/onboarding";
import enCommon from "../locales/en/common.json";
import enOnboarding from "../locales/en/onboarding.json";
import enWorkspace from "../locales/en/workspace.json";

const mocks = vi.hoisted(() => ({
  markComplete: vi.fn(),
  refreshMe: vi.fn(),
  createWorkspace: vi.fn(),
  createMikaAgent: vi.fn(),
  startMikaOnboarding: vi.fn(),
  createIssue: vi.fn(),
  patchOnboarding: vi.fn(),
  setCurrentWorkspace: vi.fn(),
  toastError: vi.fn(),
  workspaces: [] as Workspace[],
}));

const EXISTING = { id: "ws-existing", name: "Existing", slug: "existing" } as Workspace;
const CREATED = { id: "ws-created", name: "New Team", slug: "new-team" } as Workspace;

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("../auth", () => ({ useLogout: () => vi.fn() }));
vi.mock("@multica/core/config", () => ({
  useConfigStore: (selector: (state: object) => unknown) =>
    selector({ workspaceCreationDisabled: false, daemonAppUrl: "" }),
}));
vi.mock("@multica/core/platform", () => ({ setCurrentWorkspace: mocks.setCurrentWorkspace }));
vi.mock("@multica/core/api", () => ({
  api: {
    getBaseUrl: () => "https://multica.ai",
    markOnboardingComplete: mocks.markComplete,
    patchOnboarding: mocks.patchOnboarding,
    createMikaAgent: mocks.createMikaAgent,
    startMikaOnboarding: mocks.startMikaOnboarding,
    createIssue: mocks.createIssue,
  },
}));
vi.mock("@multica/core/workspace/mutations", () => ({
  useCreateWorkspace: () => ({ mutate: mocks.createWorkspace, isPending: false }),
}));
vi.mock("@multica/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector: (state: object) => unknown) =>
      selector({ user: { id: "u-1", onboarding_questionnaire: {} } }),
    { getState: () => ({ refreshMe: mocks.refreshMe, setUser: vi.fn() }) },
  ),
}));
vi.mock("@multica/core/workspace", () => ({
  useWorkspaceList: () => ({ workspaces: mocks.workspaces, ready: true }),
}));

import { OnboardingFlow } from "./onboarding-flow";

function renderFlow(props: Partial<Parameters<typeof OnboardingFlow>[0]> = {}) {
  const onComplete = vi.fn();
  render(
    <I18nProvider locale="en" resources={{
      en: { common: enCommon, onboarding: enOnboarding, workspace: enWorkspace },
    }}>
      <OnboardingFlow onComplete={onComplete} {...props} />
    </I18nProvider>,
  );
  return onComplete;
}

async function reachWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: /start exploring/i }));
  fireEvent.click(screen.getByRole("button", { name: /^skip/i }));
  await screen.findByLabelText("Workspace name");
}

function createWorkspace() {
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "New Team" } });
  fireEvent.click(screen.getByRole("button", { name: /create New Team/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaces = [];
  mocks.markComplete.mockResolvedValue(undefined);
  mocks.refreshMe.mockResolvedValue(undefined);
  mocks.patchOnboarding.mockResolvedValue({ id: "u-1" });
  mocks.createWorkspace.mockImplementation((_input, options) => options.onSuccess(CREATED));
  useWelcomeStore.getState().reset();
});

function expectNoProvisioning() {
  expect(mocks.createMikaAgent).not.toHaveBeenCalled();
  expect(mocks.startMikaOnboarding).not.toHaveBeenCalled();
  expect(mocks.createIssue).not.toHaveBeenCalled();
  expect(mocks.setCurrentWorkspace).not.toHaveBeenCalled();
  expect(useWelcomeStore.getState().signal).toBeNull();
}

describe("OnboardingFlow — workspace completion", () => {
  it("keeps intro and questionnaire, then completes the created workspace without provisioning", async () => {
    const onComplete = renderFlow();
    expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument();
    await reachWorkspace();
    createWorkspace();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    expect(mocks.markComplete).toHaveBeenCalledWith({
      completion_path: "runtime_skipped", workspace_id: CREATED.id,
    });
    expect(mocks.refreshMe).toHaveBeenCalledOnce();
    expect(mocks.patchOnboarding).toHaveBeenCalled();
    expect(screen.queryByText("Meet Mika")).not.toBeInTheDocument();
    expectNoProvisioning();
  });

  it("completes an existing workspace only after both the completion request and auth refresh", async () => {
    mocks.workspaces = [EXISTING];
    let releaseCompletion!: () => void;
    let releaseRefresh!: () => void;
    mocks.markComplete.mockReturnValue(new Promise<void>((resolve) => { releaseCompletion = resolve; }));
    mocks.refreshMe.mockReturnValue(new Promise<void>((resolve) => { releaseRefresh = resolve; }));
    const onComplete = renderFlow();
    fireEvent.click(screen.getByRole("button", { name: /start exploring/i }));
    fireEvent.click(screen.getByRole("button", { name: /^skip/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Existing/i }));
    const open = screen.getByRole("button", { name: /open Existing/i });
    fireEvent.click(open);
    expect(open).toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { releaseCompletion(); });
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { releaseRefresh(); });
    expect(onComplete).toHaveBeenCalledWith(EXISTING);
    expect(mocks.markComplete).toHaveBeenCalledWith({
      completion_path: "runtime_skipped", workspace_id: EXISTING.id,
    });
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
    expectNoProvisioning();
  });

  it("retains a newly created workspace after completion failure and retries without duplicate creation", async () => {
    mocks.workspaces = [EXISTING];
    mocks.markComplete.mockRejectedValueOnce(new Error("Complete failed"));
    const onComplete = renderFlow({ mode: "new_workspace", onCancel: vi.fn() });
    expect(screen.getByLabelText("Workspace name")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Existing/i })).not.toBeInTheDocument();
    createWorkspace();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Complete failed"));
    expect(onComplete).not.toHaveBeenCalled();
    const retry = screen.getByRole("button", { name: /open New Team/i });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(CREATED));
    expect(mocks.createWorkspace).toHaveBeenCalledOnce();
    expect(mocks.markComplete).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.markComplete.mock.calls) {
      expect(request.workspace_id).toBe(CREATED.id);
    }
    expectNoProvisioning();
  });

  it("does not navigate if refreshing the completed member fails", async () => {
    mocks.refreshMe.mockRejectedValueOnce(new Error("Refresh failed"));
    const onComplete = renderFlow({ mode: "new_workspace" });
    createWorkspace();
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Refresh failed"));
    expect(onComplete).not.toHaveBeenCalled();
    expectNoProvisioning();
  });

  it("lets new-workspace mode cancel without creating or completing anything", () => {
    mocks.workspaces = [EXISTING];
    const onCancel = vi.fn();
    const onComplete = renderFlow({ mode: "new_workspace", onCancel });
    fireEvent.click(screen.getAllByRole("button", { name: /back/i })[0]!);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
    expect(mocks.markComplete).not.toHaveBeenCalled();
    expectNoProvisioning();
  });

  it("keeps the existing-workspace shortcut retryable when completion fails", async () => {
    mocks.workspaces = [EXISTING];
    mocks.markComplete.mockRejectedValueOnce(new Error("Skip failed"));
    const onComplete = renderFlow();
    const skip = screen.getByRole("button", { name: /done this before/i });
    fireEvent.click(skip);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Skip failed"));
    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() => expect(skip).toBeEnabled());
    fireEvent.click(skip);
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(EXISTING));
    expect(mocks.markComplete).toHaveBeenLastCalledWith({
      completion_path: "skip_existing", workspace_id: EXISTING.id,
    });
    expectNoProvisioning();
  });
});
