import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShortcutPlatform } from "@multica/core/shortcuts";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { GlobalShortcuts } from "./global-shortcuts";

// GlobalShortcuts reads the sidebar context and workspace paths at render
// time; the chords below are neither, so both are stubbed to keep this test
// free of dashboard provider setup.
const h = vi.hoisted(() => ({ toggleSidebar: vi.fn() }));

vi.mock("@multica/ui/components/ui/sidebar", () => ({
  useSidebar: () => ({ toggleSidebar: h.toggleSidebar }),
}));
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    inbox: () => "/w/inbox",
    myIssues: () => "/w/my-issues",
    issues: () => "/w/issues",
    projects: () => "/w/projects",
    agents: () => "/w/agents",
    usage: () => "/w/usage",
    skills: () => "/w/skills",
    settings: () => "/w/settings",
  }),
}));

function makeAdapter(overrides: Partial<NavigationAdapter> = {}): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    pathname: "/w/issues",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
    ...overrides,
  };
}

describe("GlobalShortcuts sidebar toggle", () => {
  beforeEach(() => {
    // Pin the platform so Cmd (metaKey) maps to the primary modifier, matching
    // the Mod+B default regardless of the host running the test.
    configureShortcutPlatform("macos");
  });

  afterEach(() => {
    configureShortcutPlatform(null);
    vi.clearAllMocks();
  });

  it("toggles the sidebar on Mod+B and consumes the chord", () => {
    render(
      <NavigationProvider value={makeAdapter()}>
        <GlobalShortcuts />
      </NavigationProvider>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "b",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(h.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
