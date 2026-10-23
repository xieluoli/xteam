import { forwardRef, useEffect, useRef, useState, useImperativeHandle } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment, Issue, Label, TimelineEntry } from "@multica/core/types";
import { I18nProvider } from "@multica/core/i18n/react";
import { useResolvedExpandStore } from "@multica/core/issues/stores/resolved-expand-store";
import { useCommentCollapseStore } from "@multica/core/issues/stores";
import {
  DEFAULT_SUB_ISSUE_ROW_PROPERTIES,
  useSubIssueDisplayStore,
} from "@multica/core/issues/stores/sub-issue-display-store";
import enAgents from "../../locales/en/agents.json";
import enCommon from "../../locales/en/common.json";
import enIssues from "../../locales/en/issues.json";

const TEST_RESOURCES = { en: { agents: enAgents, common: enCommon, issues: enIssues } };

const mockViewport = vi.hoisted(() => ({ isMobile: false }));

// Counts MockContentEditor mounts. This pins the description to exactly one
// eager editor per issue and catches stale editor reuse across issue switches.
const contentEditorMounts = vi.hoisted(() => ({ count: 0 }));
// Every ReadonlyContent render, by content. A comment card renders its body
// through it, so this counts card renders without reaching into the card.
const readonlyContentRenders = vi.hoisted(() => [] as string[]);
const descriptionSelectionAction = vi.hoisted(() => ({ current: undefined as { label: string; onSelect: () => void } | undefined }));
// Stable empty-attachments reference: the real store returns a shared constant
// so the `useCommentDraftStore(s => s.getAttachments(key))` selector keeps a
// stable identity. A fresh `[]` per call would loop useSyncExternalStore.
const emptyDraftAttachments = vi.hoisted(() => [] as unknown[]);

vi.mock("@multica/ui/hooks/use-mobile", () => ({
  useIsMobile: () => mockViewport.isMobile,
}));

// useWorkspaceId() derives from useCurrentWorkspace (relative import inside
// @multica/core/hooks.tsx). vi.mock("@multica/core/paths") only intercepts
// the bare-specifier, not the internal relative import. Mock the hooks module
// directly so the bridge hook returns the test UUID.
vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @multica/core/auth
let mockAuthUser: { id: string; email: string; name: string } | null = { id: "user-1", email: "test@test.com", name: "Test User" };
vi.mock("@multica/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector?: any) => {
      const state = { user: mockAuthUser, isAuthenticated: true };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ user: mockAuthUser, isAuthenticated: true }) },
  ),
  registerAuthStore: vi.fn(),
  createAuthStore: vi.fn(),
}));

// Mock @multica/core/workspace/hooks
vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({
    getMemberName: (id: string) => (id === "user-1" ? "Test User" : "Unknown"),
    getAgentName: (id: string) => (id === "agent-1" ? "Claude Agent" : "Unknown Agent"),
    getActorName: (type: string, id: string) => {
      if (type === "member" && id === "user-1") return "Test User";
      if (type === "agent" && id === "agent-1") return "Claude Agent";
      return "Unknown";
    },
    getActorInitials: (type: string) => (type === "member" ? "TU" : "CA"),
    getActorAvatarUrl: () => null,
  }),
}));

// Mock workspace queries
vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({
    queryKey: ["workspaces", "ws-1", "members"],
    queryFn: () => Promise.resolve([{ user_id: "user-1", name: "Test User", email: "test@test.com", role: "admin" }]),
  }),
  agentListOptions: () => ({
    queryKey: ["workspaces", "ws-1", "agents"],
    queryFn: () => Promise.resolve([]),
  }),
  squadListOptions: () => ({
    queryKey: ["workspaces", "ws-1", "squads"],
    queryFn: () => Promise.resolve([]),
  }),
  assigneeFrequencyOptions: () => ({
    queryKey: ["workspaces", "ws-1", "assignee-frequency"],
    queryFn: () => Promise.resolve([]),
  }),
  workspaceListOptions: () => ({
    queryKey: ["workspaces"],
    queryFn: () => Promise.resolve([{ id: "ws-1", name: "Test WS", slug: "test" }]),
  }),
}));

// Mock @multica/core/paths — after the URL-driven workspace refactor,
// useCurrentWorkspace / useWorkspacePaths derive from the workspace slug in
// URL Context. Tests don't mount a real route, so we short-circuit to fixtures.
vi.mock("@multica/core/paths", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/paths")>(
    "@multica/core/paths",
  );
  return {
    ...actual,
    useCurrentWorkspace: () => ({ id: "ws-1", name: "Test WS", slug: "test" }),
    useWorkspacePaths: () => actual.paths.workspace("test"),
  };
});

// Mock navigation
vi.mock("../../navigation", () => ({
  AppLink: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({
    push: vi.fn(),
    pathname: "/issues/issue-1",
    getShareableUrl: (p: string) => `https://app.multica.com${p}`,
  }),
  useBackOrReplace: () => vi.fn(),
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock editor components (Tiptap requires real DOM)
vi.mock("../../editor", async () => ({
  // Real lazy-mount controller (pure React, no Tiptap) so readonly-first
  // shell → activate → ready flows behave exactly as in production.
  ...(await vi.importActual<typeof import("../../editor/use-lazy-editor")>(
    "../../editor/use-lazy-editor",
  )),
  // Real submit gate (pure React) — see comment-composers.test.tsx.
  ...(await vi.importActual<typeof import("../../editor/use-upload-gate")>(
    "../../editor/use-upload-gate",
  )),
  // Real await-then-render submit hook (pure React) so comment/reply/edit
  // composers run the production submit path.
  ...(await vi.importActual<typeof import("../../editor/use-composer-submit")>(
    "../../editor/use-composer-submit",
  )),
  useEditorUpload: () => ({
    uploadWithToast: vi.fn(),
    upload: vi.fn(),
    uploading: false,
  }),
  useFileDropZone: () => ({ isDragOver: false, dropZoneProps: {} }),
  FileDropOverlay: () => null,
  // No-op so comment-card's AttachmentList can render without hitting the
  // real API singleton; tests that care about download wiring should write
  // dedicated specs against `use-download-attachment.test.tsx`.
  useDownloadAttachment: () => vi.fn(),
  // Inert preview hook — comment-card's AttachmentList uses it to gate the
  // Eye button. Dedicated coverage lives in attachment-preview-modal.test.tsx.
  useAttachmentPreview: () => ({
    open: vi.fn(),
    tryOpen: () => false,
    modal: null,
  }),
  // Pass-through: the detail page wraps its column in the preview-sequence
  // provider, but paging between files is covered in
  // preview-sequence-context.test.tsx against the real provider.
  PreviewSequenceProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  usePreviewSequence: () => ({ openAt: () => false }),
  collectPreviewSequence: () => [],
  // Comment attachments render as their filename — the viewer and file cards
  // have their own suites.
  AttachmentDownloadProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  Attachment: ({ attachment }: { attachment: { filename?: string } }) => (
    <span data-testid="comment-attachment">{attachment.filename}</span>
  ),
  isPreviewable: () => false,
  ReadonlyContent: ({ content }: { content: string }) => {
    readonlyContentRenders.push(content);
    return <div data-testid="readonly-content">{content}</div>;
  },
  ContentEditor: forwardRef(function MockContentEditor(
    {
      defaultValue,
      value: syncedValue,
      onUpdate,
      placeholder,
      flushPendingOnUnmount,
      onReady,
      selectionAction,
    }: any,
    ref: any,
  ) {
    const initialValue = syncedValue ?? defaultValue ?? "";
    if (syncedValue !== undefined) descriptionSelectionAction.current = selectionAction;
    const valueRef = useRef(initialValue);
    const baseRef = useRef(initialValue);
    const [editorValue, setEditorValue] = useState(initialValue);
    // Mirrors the real editor's dirty guard: once the user has typed, an
    // external `value` change is refused so it cannot clobber unsaved bytes.
    // Only the imperative adoptContent channel lands after that point.
    const dirtyRef = useRef(false);
    useEffect(() => {
      contentEditorMounts.count += 1;
      onReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
      if (syncedValue === undefined || dirtyRef.current) return;
      valueRef.current = syncedValue;
      baseRef.current = syncedValue;
      setEditorValue(syncedValue);
    }, [syncedValue]);
    useImperativeHandle(ref, () => ({
      getMarkdown: () => valueRef.current,
      clearContent: () => {
        valueRef.current = "";
        dirtyRef.current = false;
        setEditorValue("");
      },
      // The real handle applies content the `value` prop cannot land (a dirty
      // editor refuses external syncs) and does so without emitting an update.
      adoptContent: (markdown: string) => {
        valueRef.current = markdown;
        baseRef.current = markdown;
        dirtyRef.current = false;
        setEditorValue(markdown);
      },
      focus: () => {},
      focusAtCoords: () => {},
      // The top-level composer blurs after a posted comment (afterAccepted).
      blur: () => {},
      // Read by the submit-time upload gate; no uploads are exercised here.
      hasActiveUploads: () => false,
      // Placeholder rebuild contract: the real handle draws a card for an
      // upload the document is not showing and reports whether it landed.
      // Mocks track ids only — no document to draw into.
      insertUploadPlaceholder: () => true,
      settleUploadPlaceholder: () => false,
      uploadFile: () => {},
    }));
    return (
      <textarea
        value={editorValue}
        onChange={(e) => {
          valueRef.current = e.target.value;
          dirtyRef.current = true;
          setEditorValue(e.target.value);
          onUpdate?.(e.target.value, baseRef.current);
        }}
        placeholder={placeholder}
        data-testid="rich-text-editor"
        data-flush-on-unmount={flushPendingOnUnmount ? "true" : undefined}
      />
    );
  }),
  TitleEditor: forwardRef(function MockTitleEditor(
    { defaultValue, placeholder, onBlur, onChange, onReady }: any,
    ref: any,
  ) {
    const valueRef = useRef(defaultValue || "");
    const [value, setValue] = useState(defaultValue || "");
    useEffect(() => {
      onReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useImperativeHandle(ref, () => ({
      getText: () => valueRef.current,
      focus: () => {},
      focusAtCoords: () => {},
    }));
    return (
      <input
        value={value}
        onChange={(e) => {
          valueRef.current = e.target.value;
          setValue(e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={() => onBlur?.(valueRef.current)}
        placeholder={placeholder}
        data-testid="title-editor"
      />
    );
  }),
}));

// Mock common components
vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: ({ actorType, actorId }: any) => (
    <span data-testid="actor-avatar">
      {actorType}:{actorId}
    </span>
  ),
}));

vi.mock("../../projects/components/project-picker", () => ({
  ProjectPicker: () => <span data-testid="project-picker">Project</span>,
}));

// Mock api
const mockApiObj = vi.hoisted(() => ({
  getIssue: vi.fn(),
  listTimeline: vi.fn().mockResolvedValue([]),
  listComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  deleteIssue: vi.fn(),
  updateIssue: vi.fn(),
  listIssueSubscribers: vi.fn().mockResolvedValue([]),
  listIssueImportedUsage: vi.fn().mockResolvedValue([]),
  subscribeToIssue: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromIssue: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromIssueSubtree: vi.fn().mockResolvedValue(undefined),
  getActiveTasksForIssue: vi.fn().mockResolvedValue({ tasks: [] }),
  listTasksByIssue: vi.fn().mockResolvedValue([]),
  rerunIssue: vi.fn(),
  listTaskMessages: vi.fn().mockResolvedValue([]),
  listChildIssues: vi.fn().mockResolvedValue({ issues: [] }),
  getChildIssueProgress: vi.fn().mockResolvedValue({ progress: [] }),
  getAgentTaskSnapshot: vi.fn().mockResolvedValue([]),
  // The sub-issues header chip reads this narrowed to the parent issue.
  getWorkspaceWorkingAgents: vi.fn().mockResolvedValue([]),
  listProperties: vi.fn().mockResolvedValue({ properties: [], total: 0 }),
  listIssues: vi.fn().mockResolvedValue({ issues: [], total: 0 }),
  uploadFile: vi.fn(),
  listIssueReactions: vi.fn().mockResolvedValue([]),
  addIssueReaction: vi.fn(),
  removeIssueReaction: vi.fn(),
  listAttachments: vi.fn().mockResolvedValue([]),
  addCommentReaction: vi.fn(),
  removeCommentReaction: vi.fn(),
  listMembers: vi.fn().mockResolvedValue([{ user_id: "user-1", name: "Test User", email: "test@test.com", role: "admin" }]),
  listAgents: vi.fn().mockResolvedValue([]),
  getAgent: vi.fn().mockResolvedValue(null),
  listRuntimes: vi.fn().mockResolvedValue([]),
  getProject: vi.fn(),
  listProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

vi.mock("@multica/core/api", () => ({
  api: mockApiObj,
  getApi: () => mockApiObj,
  setApiInstance: vi.fn(),
  errorCode: (error: unknown) =>
    typeof error === "object" && error !== null && "body" in error
      ? (error as { body?: { code?: string } }).body?.code
      : undefined,
}));

// Mock issue config
// Use the real status configuration so category fixtures cannot drift.

// Mock recent issues store
const mockRecordVisit = vi.fn();
vi.mock("@multica/core/issues/stores", async () => ({
  // Real store, not a stub: resolved-thread expand/collapse behavior under
  // test runs through it. Deep import keeps the persisted sibling stores
  // (which need localStorage) out of this mock.
  ...(await vi.importActual<
    typeof import("@multica/core/issues/stores/resolved-expand-store")
  >("@multica/core/issues/stores/resolved-expand-store")),
  // Real store: sub-issue display tests drive it with setState, and the
  // component reads it through the barrel — both must hit the same instance.
  ...(await vi.importActual<
    typeof import("@multica/core/issues/stores/sub-issue-display-store")
  >("@multica/core/issues/stores/sub-issue-display-store")),
  // Real store, in-memory (no localStorage): backs the sub-issues section's
  // collapsed state.
  ...(await vi.importActual<
    typeof import("@multica/core/issues/stores/sub-issues-collapse-store")
  >("@multica/core/issues/stores/sub-issues-collapse-store")),
  useRecentIssuesStore: Object.assign(
    (selector?: any) => {
      const state = { byWorkspace: {}, recordVisit: mockRecordVisit, pruneWorkspaces: vi.fn() };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        byWorkspace: {},
        recordVisit: mockRecordVisit,
        pruneWorkspaces: vi.fn(),
      }),
    },
  ),
  selectRecentIssues: () => () => [],
  // Reactive in-memory stand-in: a quick-jump to a reply reopens a thread the
  // reader collapsed, so the card has to re-render when `toggle` runs.
  useCommentCollapseStore: (await vi.importActual<typeof import("zustand")>("zustand")).create<{
    collapsedByIssue: Record<string, string[]>;
    isCollapsed: (issueId: string, commentId: string) => boolean;
    toggle: (issueId: string, commentId: string) => void;
  }>()((set, get) => ({
    collapsedByIssue: {},
    isCollapsed: (issueId, commentId) => get().collapsedByIssue[issueId]?.includes(commentId) ?? false,
    toggle: (issueId, commentId) =>
      set((s) => {
        const current = s.collapsedByIssue[issueId] ?? [];
        return {
          collapsedByIssue: {
            ...s.collapsedByIssue,
            [issueId]: current.includes(commentId)
              ? current.filter((c) => c !== commentId)
              : [...current, commentId],
          },
        };
      }),
  })),
  useCommentDraftStore: Object.assign(
    (selector?: any) => {
      const state = {
        drafts: {} as Record<string, { content: string; attachments: unknown[]; updatedAt: number }>,
        getDraft: () => undefined,
        getAnnotations: () => emptyDraftAttachments,
        getAttachments: () => emptyDraftAttachments,
        getUploads: () => emptyDraftAttachments,
        setDraft: () => {},
        setAttachments: () => {},
        addUpload: () => {},
        settleUpload: () => {},
        failUpload: () => {},
        removeUpload: () => {},
        clearDraft: () => {},
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        drafts: {} as Record<string, { content: string; attachments: unknown[]; updatedAt: number }>,
        getDraft: () => undefined,
        getAnnotations: () => emptyDraftAttachments,
        getAttachments: () => emptyDraftAttachments,
        getUploads: () => emptyDraftAttachments,
        setDraft: () => {},
        setAttachments: () => {},
        addUpload: () => {},
        settleUpload: () => {},
        failUpload: () => {},
        removeUpload: () => {},
        clearDraft: () => {},
      }),
    },
  ),
  useCommentComposerStore: Object.assign(
    (selector?: any) => {
      const state = { sticky: true, toggleSticky: () => {} };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({ sticky: true, toggleSticky: () => {} }),
    },
  ),
}));

// Mock react-virtuoso: jsdom has no real layout, so the real Virtuoso would
// compute a 0-height viewport and render nothing. The mock renders every item
// inline so id="comment-..." nodes are always present in the DOM — this
// matches the production cold-path where `initialItemCount` force-mounts
// items[0..targetIdx], giving the deep-link effect a real target node.
//
// scrollIntoViewSpy: the deep-link effect no longer calls native
// scrollIntoView (it drives the timeline container's scrollTop directly to
// avoid scrolling ancestor overflow:hidden boxes — see issue-detail.tsx). We
// keep a no-op stub on the prototype so any stray scrollIntoView call from
// other components doesn't throw; deep-link tests assert the highlight
// background instead, which is mechanism-independent and observable without
// layout.
const scrollIntoViewSpy = vi.hoisted(() => vi.fn());
const scrollToIndexSpy = vi.hoisted(() => vi.fn());

vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function MockVirtuoso(
    { data, itemContent, computeItemKey }: {
      data: unknown[];
      itemContent: (i: number, item: unknown) => unknown;
      computeItemKey: (i: number, item: unknown) => React.Key;
    },
    ref: any,
  ) {
    useImperativeHandle(ref, () => ({
      // Real Virtuoso ref methods are not exercised by tests in this file
      // since the deep-link cold-path drives the container's scrollTop on the
      // real DOM node, not Virtuoso's imperative API.
      scrollIntoView: vi.fn(),
      scrollToIndex: scrollToIndexSpy,
    }));
    return (
      <div data-testid="virtuoso-mock">
        {data.map((item, i) => (
          <div key={computeItemKey(i, item)}>{itemContent(i, item) as React.ReactElement}</div>
        ))}
      </div>
    );
  }),
}));

// jsdom's HTMLElement.prototype.scrollIntoView is a no-op stub; replace it
// with a spy so the deep-link effect's call can be observed.
beforeEach(() => {
  scrollIntoViewSpy.mockClear();
  scrollToIndexSpy.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoViewSpy,
  });
  // The resolved-expand store is module-global (not per-mount like the old
  // useState); reset so one test's expansions can't leak into the next.
  useResolvedExpandStore.setState({ expandedByIssue: {} });
  useCommentCollapseStore.setState({ collapsedByIssue: {} });
});

// Mock modals
const mockOpenModal = vi.hoisted(() => vi.fn());
vi.mock("@multica/core/modals", () => ({
  useModalStore: Object.assign(
    (selector?: (state: { open: typeof mockOpenModal }) => unknown) => {
      const state = { open: mockOpenModal };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ open: mockOpenModal }) },
  ),
}));

// Mock core/hooks/use-file-upload
vi.mock("@multica/core/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ uploadWithToast: vi.fn().mockResolvedValue("https://example.com/file.png") }),
}));

// Mock realtime
vi.mock("@multica/core/realtime", () => ({
  useWSEvent: vi.fn(),
  useWSReconnect: vi.fn(),
  useWS: () => ({ subscribe: vi.fn(() => () => {}), onReconnect: vi.fn(() => () => {}) }),
  WSProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtimeSync: () => {},
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock react-resizable-panels (used by @multica/ui/components/ui/resizable)
vi.mock("react-resizable-panels", () => ({
  Group: ({ children, ...props }: any) => <div data-testid="panel-group" {...props}>{children}</div>,
  Panel: ({ children, ...props }: any) => <div data-testid="panel" {...props}>{children}</div>,
  Separator: ({ children, ...props }: any) => <div data-testid="panel-handle" {...props}>{children}</div>,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
  usePanelRef: () => ({ current: { isCollapsed: () => false, expand: vi.fn(), collapse: vi.fn() } }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockIssue: Issue = {
  id: "issue-1",
  workspace_id: "ws-1",
  number: 1,
  identifier: "TES-1",
  title: "Implement authentication",
  description: "Add JWT auth to the backend",
  status: "in_progress",
  priority: "high",
  assignee_type: "member",
  assignee_id: "user-1",
  creator_type: "member",
  creator_id: "user-1",
  parent_issue_id: null,
  project_id: null,
  position: 0,
  stage: null,
  start_date: null,
  due_date: "2026-06-01T00:00:00Z",
  metadata: {},
  properties: {},
  created_at: "2026-01-15T00:00:00Z",
  updated_at: "2026-01-20T00:00:00Z",
  revision: 3,
};

const mockTimeline: TimelineEntry[] = [
  {
    type: "comment",
    id: "comment-1",
    actor_type: "member",
    actor_id: "user-1",
    content: "Started working on this",
    parent_id: null,
    created_at: "2026-01-16T00:00:00Z",
    updated_at: "2026-01-16T00:00:00Z",
    comment_type: "comment",
  },
  {
    type: "comment",
    id: "comment-2",
    actor_type: "agent",
    actor_id: "agent-1",
    content: "I can help with this",
    parent_id: null,
    created_at: "2026-01-17T00:00:00Z",
    updated_at: "2026-01-17T00:00:00Z",
    comment_type: "comment",
  },
];

// ---------------------------------------------------------------------------
// Import component under test (after mocks)
// ---------------------------------------------------------------------------

import { IssueDetail, groupSubIssuesByStage } from "./issue-detail";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderIssueDetail(issueId = "issue-1") {
  const queryClient = createTestQueryClient();
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={queryClient}>
        <IssueDetail issueId={issueId} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IssueDetail (shared)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthUser = { id: "user-1", email: "test@test.com", name: "Test User" };
    contentEditorMounts.count = 0;
    readonlyContentRenders.length = 0;
    descriptionSelectionAction.current = undefined;
    mockViewport.isMobile = false;
    // Default: issue loads successfully
    mockApiObj.getIssue.mockResolvedValue(mockIssue);
    // /timeline returns the entries flat in chronological order (oldest first).
    mockApiObj.listTimeline.mockResolvedValue(mockTimeline);
    mockApiObj.listIssueReactions.mockResolvedValue([]);
    mockApiObj.listIssueSubscribers.mockResolvedValue([]);
    mockApiObj.listIssueImportedUsage.mockResolvedValue([]);
    mockApiObj.listChildIssues.mockResolvedValue({ issues: [] });
    mockApiObj.getChildIssueProgress.mockResolvedValue({ progress: [] });
    mockApiObj.getAgentTaskSnapshot.mockResolvedValue([]);
    mockApiObj.getWorkspaceWorkingAgents.mockResolvedValue([]);
    mockApiObj.listProperties.mockResolvedValue({ properties: [], total: 0 });
    mockApiObj.listIssues.mockResolvedValue({ issues: [], total: 0 });
    mockApiObj.getActiveTasksForIssue.mockResolvedValue({ tasks: [] });
    mockApiObj.listTasksByIssue.mockResolvedValue([]);
    mockApiObj.listTaskMessages.mockResolvedValue([]);
    mockApiObj.listMembers.mockResolvedValue([
      { user_id: "user-1", name: "Test User", email: "test@test.com", role: "admin" },
    ]);
    mockApiObj.listAgents.mockResolvedValue([]);
    // Reset project mock — individual tests override per case. Default fixture
    // has project_id: null so getProject is not invoked.
    mockApiObj.getProject.mockReset();
  });

  it("replaces the comment feed with a saved conclusion and reloads the server value", async () => {
    mockApiObj.getIssue.mockResolvedValue({ ...mockIssue, conclusion: "Initial decision" });
    mockApiObj.updateIssue.mockImplementation(async (_id, patch) => ({ ...mockIssue, ...patch }));
    const first = renderIssueDetail();
    const field = await screen.findByRole("textbox", { name: "Conclusion" });
    expect(field).toHaveValue("Initial decision");
    expect(screen.queryByText("Started working on this")).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Approved for release" } });
    fireEvent.click(screen.getByRole("button", { name: "Save conclusion" }));
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalledWith("issue-1", expect.objectContaining({ conclusion: "Approved for release" })));
    first.unmount();
    mockApiObj.getIssue.mockResolvedValue({ ...mockIssue, conclusion: "Approved for release" });
    renderIssueDetail();
    expect(await screen.findByRole("textbox", { name: "Conclusion" })).toHaveValue("Approved for release");
  });

  it("keeps the conclusion draft and offers retry when saving fails", async () => {
    mockApiObj.updateIssue.mockRejectedValue(new Error("Save failed"));
    renderIssueDetail();
    const field = await screen.findByRole("textbox", { name: "Conclusion" });
    fireEvent.change(field, { target: { value: "Keep my decision" } });
    fireEvent.click(screen.getByRole("button", { name: "Save conclusion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to save conclusion");
    expect(field).toHaveValue("Keep my decision");
    expect(screen.getByRole("button", { name: "Save conclusion" })).toBeEnabled();
  });

  it("clears a conclusion with an empty string", async () => {
    mockApiObj.getIssue.mockResolvedValue({ ...mockIssue, conclusion: "Old decision" });
    mockApiObj.updateIssue.mockImplementation(async (_id, patch) => ({ ...mockIssue, ...patch }));
    renderIssueDetail();
    const field = await screen.findByRole("textbox", { name: "Conclusion" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save conclusion" }));
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalledWith("issue-1", expect.objectContaining({ conclusion: "" })));
  });

  it("makes a conclusion read-only without a signed-in user", async () => {
    mockAuthUser = null;
    renderIssueDetail();
    expect(await screen.findByRole("textbox", { name: "Conclusion" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save conclusion" })).toBeDisabled();
    expect(mockApiObj.updateIssue).not.toHaveBeenCalled();
  });

  it("counts comment files as deliverables, a re-upload once as v2, never the description's (MUL-7649)", async () => {
    const file = (id: string, over: Partial<Attachment>): Attachment => ({
      id,
      workspace_id: "ws-1",
      issue_id: "issue-1",
      comment_id: null,
      chat_session_id: null,
      chat_message_id: null,
      uploader_type: "agent",
      uploader_id: "agent-1",
      filename: "report.md",
      url: `https://cdn.example.test/${id}`,
      download_url: `https://cdn.example.test/${id}`,
      markdown_url: `https://cdn.example.test/${id}`,
      content_type: "text/markdown",
      size_bytes: 2048,
      created_at: "2026-01-16T00:00:00Z",
      ...over,
    });
    const brief = file("brief", { filename: "brief.pdf", content_type: "application/pdf", uploader_type: "member" });
    const v1 = file("report-v1", { comment_id: "comment-1" });
    const v2 = file("report-v2", { comment_id: "comment-2", created_at: "2026-01-17T00:00:00Z" });
    mockApiObj.getIssue.mockResolvedValue({ ...mockIssue, description: "!file[brief.pdf](https://cdn.example.test/brief)" });
    mockApiObj.listAttachments.mockResolvedValue([brief, v1, v2]);
    mockApiObj.listTimeline.mockResolvedValue([
      { ...mockTimeline[0]!, attachments: [v1] },
      { ...mockTimeline[1]!, attachments: [v2] },
    ]);

    renderIssueDetail();

    const header = await screen.findByRole("button", { name: /^Deliverables/ });
    expect(header).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "report.md, version 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all 1 deliverable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "brief.pdf" })).toBeNull();
  });

  it("shows loading skeleton while data is loading", () => {
    // Make the API hang to keep loading state
    mockApiObj.getIssue.mockReturnValue(new Promise(() => {}));
    renderIssueDetail();

    expect(
      screen.getAllByRole("generic").some((el) => el.getAttribute("data-slot") === "skeleton"),
    ).toBe(true);
  });

  it("gives the skeleton the same horizontal gutters as the loaded column", async () => {
    // The skeleton is the loaded column's stand-in, so a gutter change has to
    // land on both or the column jumps sideways at the moment the issue
    // arrives. Horizontal only: the loaded column also reserves the chat
    // launcher's corner at its bottom, which the skeleton has no scroll to
    // reach.
    const horizontalGutters = (el: Element | null) =>
      (el?.className ?? "")
        .split(/\s+/)
        .filter((cls) => /(^|:)px-/.test(cls))
        .sort();

    mockApiObj.getIssue.mockReturnValue(new Promise(() => {}));
    const loadingRender = renderIssueDetail();
    const skeletonGutters = horizontalGutters(
      loadingRender.container.querySelector(".max-w-4xl"),
    );
    loadingRender.unmount();

    mockApiObj.getIssue.mockResolvedValue(mockIssue);
    const { container } = renderIssueDetail();
    await waitFor(() => {
      expect(screen.getByText("Implement authentication")).toBeInTheDocument();
    });

    // Non-empty guard: without it a renamed column class passes vacuously.
    expect(skeletonGutters.length).toBeGreaterThan(0);
    expect(skeletonGutters).toEqual(
      horizontalGutters(container.querySelector(".max-w-4xl")),
    );
  });

  it("renders issue title and description after loading", async () => {
    renderIssueDetail();

    // The description is the one eager editor: keeping one renderer avoids the
    // layout jump caused by swapping a long react-markdown tree for ProseMirror.
    // Title and comment/reply composers remain readonly-first.
    expect(await screen.findByDisplayValue("Add JWT auth to the backend")).toBeInTheDocument();
    expect(screen.getByText("Implement authentication")).toBeInTheDocument();
    expect(screen.queryByTestId("title-editor")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("rich-text-editor")).toHaveLength(1);
    expect(contentEditorMounts.count).toBe(1);
  });

  it("reconciles a cached list snapshot so source context appears on first entry", async () => {
    const sourceContext: NonNullable<Issue["source_context"]> = {
      id: "context-1",
      version: 1,
      usage: "read_only_historical_background",
      captured_at: "2026-08-21T12:00:00Z",
      display_state: "unchanged",
      source_issue_state: "unchanged",
      comment_thread_state: "unchanged",
      anchor_comment_state: "available",
      can_open_current_source: true,
      current_source: {
        issue_id: "source-issue",
        anchor_comment_id: "source-comment",
        identifier: "TES-7",
      },
      source_author_state: [],
      snapshot: {
        version: 1,
        captured_by_user_id: "user-1",
        captured_at: "2026-08-21T12:00:00Z",
        source_issue: {
          id: "source-issue",
          identifier: "TES-7",
          number: 7,
          title: "Source issue",
          description: "Source description",
          created_at: "2026-08-20T00:00:00Z",
          updated_at: "2026-08-21T00:00:00Z",
          revision: 2,
          attachments: [],
        },
        anchor_comment_id: "source-comment",
        comment_thread: [
          {
            id: "source-comment",
            parent_id: null,
            type: "comment",
            content: "Source comment",
            author: { type: "member", id: "user-1", name: "Test User" },
            created_at: "2026-08-21T01:00:00Z",
            updated_at: "2026-08-21T01:00:00Z",
            revision: 1,
            attachments: [],
          },
        ],
      },
    };
    const cachedWithoutDetailOnlyContext: Issue = {
      ...mockIssue,
      parent_issue_id: "source-issue",
    };
    const authoritativeDetail: Issue = {
      ...cachedWithoutDetailOnlyContext,
      source_context: sourceContext,
    };
    const parentIssue: Issue = {
      ...mockIssue,
      id: "source-issue",
      identifier: "TES-7",
      number: 7,
      title: "Source issue",
      parent_issue_id: null,
    };
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(
      ["issues", "ws-1", "detail", "issue-1"],
      cachedWithoutDetailOnlyContext,
    );
    mockApiObj.getIssue.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "source-issue" ? parentIssue : authoritativeDetail),
    );

    render(
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <QueryClientProvider client={queryClient}>
          <IssueDetail issueId="issue-1" />
        </QueryClientProvider>
      </I18nProvider>,
    );

    const snapshotAction = await screen.findByRole("button", { name: "Context snapshot" });
    const summary = snapshotAction.closest<HTMLElement>('[data-slot="source-context-summary"]');
    expect(summary).toHaveTextContent("Sub-issue of");
    expect(within(summary!).getByRole("link", { name: "TES-7 Source issue" })).toBeInTheDocument();
    // The summary replaces the plain parent row rather than adding a second one.
    expect(screen.getAllByText("Sub-issue of")).toHaveLength(1);
    expect(screen.queryByText(/From TES-7/)).not.toBeInTheDocument();
    expect(mockApiObj.getIssue).toHaveBeenCalledWith("issue-1");
  });

  it("opts the description editor into the unmount flush", async () => {
    // Closing the issue modal must save the description the user last saw —
    // ContentEditor drops pending debounced updates on unmount by default
    // (so cancelled comment drafts aren't resurrected), and only this
    // explicit opt-in keeps a paste-then-close from losing the image
    // markdown and its attachment_ids bind (MUL-3254). The flush behavior
    // itself is covered in content-editor.test.tsx; this pins the wiring.
    renderIssueDetail();

    const description = await screen.findByDisplayValue("Add JWT auth to the backend");
    expect(description).toHaveAttribute("data-flush-on-unmount", "true");
  });

  it("remounts the eager description on issue switch without carrying stale content", async () => {
    // The web route reuses IssueDetail across issues. The keyed description
    // editor must remount atomically for the new issue while the title remains
    // on its cheap stand-in.
    const queryClient = createTestQueryClient();
    const issue2 = {
      ...mockIssue,
      id: "issue-2",
      title: "Second issue",
      description: "Second description",
    };
    // The cache seed marks the data stale, so the query refetches in the
    // background — getIssue must answer per-id or the refetch would clobber
    // issue-2 with issue-1's payload.
    mockApiObj.getIssue.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "issue-2" ? issue2 : mockIssue),
    );
    // Pre-seed issue-2 so its first render skips the loading skeleton.
    queryClient.setQueryData(["issues", "ws-1", "detail", "issue-2"], issue2);
    const ui = (issueId: string) => (
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <QueryClientProvider client={queryClient}>
          <IssueDetail issueId={issueId} />
        </QueryClientProvider>
      </I18nProvider>
    );
    const { rerender } = render(ui("issue-1"));

    await screen.findByDisplayValue("Add JWT auth to the backend");
    const mountsBeforeSwitch = contentEditorMounts.count;

    rerender(ui("issue-2"));

    expect(await screen.findByDisplayValue("Second description")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Add JWT auth to the backend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("title-editor")).not.toBeInTheDocument();
    expect(contentEditorMounts.count).toBe(mountsBeforeSwitch + 1);
  });

  it("renders the issue title leaf as a link to the issue detail page", async () => {
    renderIssueDetail();

    // The breadcrumb leaf is the whole "identifier + title" string wrapped in a
    // single link to the issue's own detail route (used to open the full page
    // from the inline Inbox pane). A bare issue has no ancestor crumbs.
    const leaf = await screen.findByText("TES-1 Implement authentication");
    expect(leaf.closest("a")).toHaveAttribute("href", "/test/issues/issue-1");
  });

  it("omits the project breadcrumb segment when the issue has no project_id", async () => {
    // Default fixture has project_id: null.
    renderIssueDetail();

    // Leaf renders once loaded; a bare issue has no ancestor crumbs at all.
    await screen.findByText("TES-1 Implement authentication");

    // Project is never fetched and no project crumb appears.
    expect(mockApiObj.getProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Marketing site refresh")).not.toBeInTheDocument();
  });

  it("renders the project breadcrumb segment when the issue belongs to a project", async () => {
    mockApiObj.getIssue.mockResolvedValue({ ...mockIssue, project_id: "p-1" });
    mockApiObj.getProject.mockResolvedValue({
      id: "p-1",
      workspace_id: "ws-1",
      title: "Marketing site refresh",
      description: null,
      icon: "🚀",
      status: "in_progress",
      priority: "none",
      lead_type: null,
      lead_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      issue_count: 0,
      done_count: 0,
      resource_count: 0,
    });

    renderIssueDetail();

    const projectLink = await screen.findByText("Marketing site refresh");
    // The whole project segment is a single AppLink pointing at the project
    // detail route under the active workspace slug.
    expect(projectLink.closest("a")).toHaveAttribute("href", "/test/projects/p-1");
  });

  it("renders properties sidebar with all core rows plus set optional rows", async () => {
    renderIssueDetail();

    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument();
    });

    // Core rows — always rendered regardless of whether the issue has a value.
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    // "Project" appears twice (row label + picker stub), so disambiguate by id.
    expect(screen.getByTestId("project-picker")).toBeInTheDocument();
    // priority="high" + due_date are set in the fixture, so both optional rows show.
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Due date")).toBeInTheDocument();
    // No labels are attached in the fixture — the Labels optional row
    // must stay hidden by default.
    expect(screen.queryByText("Labels")).not.toBeInTheDocument();
    // Parent issue lives in its own section and only renders when the
    // issue actually has a parent — the fixture has none.
    expect(screen.queryByText("Parent issue")).not.toBeInTheDocument();
    // The "+ Add property" affordance is always offered while any
    // optional field is still hidden.
    expect(screen.getByText("Add property")).toBeInTheDocument();
  });

  it("hides every optional property row when none are set", async () => {
    // Override the default fixture: nothing optional set.
    mockApiObj.getIssue.mockResolvedValue({
      ...mockIssue,
      priority: "none",
      start_date: null,
      due_date: null,
    });

    renderIssueDetail();

    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument();
    });

    expect(screen.queryByText("Priority")).not.toBeInTheDocument();
    expect(screen.queryByText("Due date")).not.toBeInTheDocument();
    expect(screen.queryByText("Labels")).not.toBeInTheDocument();
    // Project stays as a core row regardless of value.
    expect(screen.getByTestId("project-picker")).toBeInTheDocument();
    // No parent → no standalone Parent issue section either.
    expect(screen.queryByText("Parent issue")).not.toBeInTheDocument();
    expect(screen.getByText("Add property")).toBeInTheDocument();
  });

  it("uses a non-resizable layout with the sidebar sheet closed by default on mobile", async () => {
    mockViewport.isMobile = true;

    renderIssueDetail();

    await waitFor(() => {
      expect(screen.getByText("Implement authentication")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("panel-group")).not.toBeInTheDocument();
    expect(screen.queryByText("Properties")).not.toBeInTheDocument();
  });

  // The peek's close button lives in the host's trailing controls, so every
  // state the peek can show must carry them (review of #8886).
  function renderPeek(issueId = "issue-1") {
    const queryClient = createTestQueryClient();
    return render(
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <QueryClientProvider client={queryClient}>
          <IssueDetail
            issueId={issueId}
            variant="peek"
            onDelete={() => {}}
            leadingAction={<span data-testid="peek-nav" />}
            trailingActions={<button type="button">Close preview</button>}
          />
        </QueryClientProvider>
      </I18nProvider>,
    );
  }

  it("keeps the peek's host controls while the issue is loading", () => {
    mockApiObj.getIssue.mockReturnValue(new Promise(() => {}));
    renderPeek();
    expect(screen.getByTestId("peek-nav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close preview" })).toBeInTheDocument();
  });

  it("keeps the peek's host controls when the issue cannot be loaded", async () => {
    mockApiObj.getIssue.mockRejectedValue(new Error("Not found"));
    renderPeek("nonexistent-id");
    await waitFor(() => {
      expect(
        screen.getByText("This issue does not exist or has been deleted in this workspace."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Close preview" })).toBeInTheDocument();
  });

  it("renders the peek variant as one column with property pills and host actions", async () => {
    const queryClient = createTestQueryClient();
    render(
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <QueryClientProvider client={queryClient}>
          <IssueDetail
            issueId="issue-1"
            variant="peek"
            leadingAction={<span data-testid="peek-nav" />}
            trailingActions={<button type="button">Close preview</button>}
          />
        </QueryClientProvider>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Implement authentication")).toBeInTheDocument();
    });

    // No resizable sidebar: the properties become pills under the title.
    expect(screen.queryByTestId("panel-group")).not.toBeInTheDocument();
    expect(screen.queryByText("Properties")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-picker")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // The host's controls replace the sidebar toggle.
    expect(screen.getByTestId("peek-nav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close preview" })).toBeInTheDocument();
    // The header leaf names the issue by identifier only — the title is right below.
    expect(screen.getByRole("link", { name: mockIssue.identifier })).toBeInTheDocument();
  });

  it("lets the composer ride the end of the timeline on mobile", async () => {
    // A pinned composer on a phone sits on the chat launcher's corner at every
    // scroll position, and the part it covers is its own send button.
    mockViewport.isMobile = true;

    const { container } = renderIssueDetail();

    await waitFor(() => {
      expect(screen.getByText("Implement authentication")).toBeInTheDocument();
    });

    expect(container.querySelector(".sticky.bottom-0")).toBeNull();
  });

  it("hides metadata content from the sidebar and shows a button when the bag has keys", async () => {
    // Metadata is agent-facing; the sidebar only exposes a button that opens
    // the raw JSON on demand. Keys are NOT rendered inline anywhere.
    mockApiObj.getIssue.mockResolvedValue({
      ...mockIssue,
      metadata: {
        pr_url: "https://example.com/pr/1",
        pipeline_status: "running",
      },
    });

    renderIssueDetail();

    await waitFor(() => {
      // Trigger label includes a "· N" count so users can see payload size
      // before clicking — accept any count via regex.
      expect(screen.getByRole("button", { name: /^Metadata\b/ })).toBeInTheDocument();
    });

    // Key names are not rendered in the sidebar prior to opening the dialog.
    expect(screen.queryByText("pr_url")).not.toBeInTheDocument();
    expect(screen.queryByText("pipeline_status")).not.toBeInTheDocument();
  });

  it("opens a dialog with formatted JSON when the Metadata button is clicked", async () => {
    mockApiObj.getIssue.mockResolvedValue({
      ...mockIssue,
      metadata: {
        pr_url: "https://example.com/pr/1",
        pipeline_status: "running",
      },
    });

    renderIssueDetail();

    const button = await screen.findByRole("button", { name: /^Metadata\b/ });
    fireEvent.click(button);

    // The dialog renders a <pre> containing the formatted JSON; checking the
    // exact serialized payload also verifies the indent / structure.
    const expected = JSON.stringify(
      { pr_url: "https://example.com/pr/1", pipeline_status: "running" },
      null,
      2,
    );
    await waitFor(() => {
      const pre = document.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre!.textContent).toBe(expected);
    });
  });

  it("hides the Metadata button entirely when the bag is empty", async () => {
    // Default fixture already has metadata: {}, asserted explicitly here.
    renderIssueDetail();

    await waitFor(() => {
      expect(screen.getByText("Details")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /^Metadata\b/ })).not.toBeInTheDocument();
  });

  it("shows 'not found' message when issue does not exist", async () => {
    mockApiObj.getIssue.mockRejectedValue(new Error("Not found"));

    renderIssueDetail("nonexistent-id");

    await waitFor(() => {
      expect(
        screen.getByText("This issue does not exist or has been deleted in this workspace."),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Back' button when issue is not found and no onDelete prop", async () => {
    mockApiObj.getIssue.mockRejectedValue(new Error("Not found"));

    renderIssueDetail("nonexistent-id");

    await waitFor(() => {
      expect(screen.getByText("Back")).toBeInTheDocument();
    });
  });

  it("sends empty description when editor is cleared", async () => {
    renderIssueDetail();

    const editor = await screen.findByDisplayValue("Add JWT auth to the backend");
    fireEvent.change(editor, { target: { value: "" } });

    await waitFor(() => {
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        "issue-1",
        expect.objectContaining({
          description: "",
          description_base: "Add JWT auth to the backend",
        }),
      );
    });
  });

  // Descriptions are last-write-wins (MUL-6971). The baseline still ships as
  // channel-media merge metadata, but a rejected save no longer opens a compare
  // panel — that panel fired on the editor's own autosave and wedged the
  // session, and the title/comment editors keep the compare flow they can
  // actually satisfy.
  it("keeps editing after a failed description save without a compare panel", async () => {
    mockApiObj.updateIssue.mockRejectedValueOnce({
      body: { code: "revision_conflict" },
    });
    renderIssueDetail();

    const editor = await screen.findByDisplayValue("Add JWT auth to the backend");
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "My local description" } });

    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        "issue-1",
        expect.objectContaining({
          description: "My local description",
          description_base: "Add JWT auth to the backend",
        }),
      ),
    );
    // The compare panel's own actions — still rendered for a title conflict,
    // so their absence is about the description, not a missing translation.
    expect(
      screen.queryByRole("button", { name: "Keep my version" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use the latest version" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("My local description")).toBeVisible();

    // The save gate reopened: the next edit still reaches the server.
    fireEvent.change(editor, { target: { value: "My next description" } });
    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenLastCalledWith(
        "issue-1",
        expect.objectContaining({ description: "My next description" }),
      ),
    );
  });

  it("serializes description saves and rebases the queued draft on submitted content", async () => {
    let resolveFirst!: (issue: Issue) => void;
    const firstSave = new Promise<Issue>((resolve) => {
      resolveFirst = resolve;
    });
    mockApiObj.updateIssue
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({
        ...mockIssue,
        description: "Second local description",
        revision: 5,
      });
    renderIssueDetail();

    const editor = await screen.findByDisplayValue("Add JWT auth to the backend");
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "First local description" } });
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: "Second local description" } });
    expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ ...mockIssue, description: "First local description", revision: 4 });
      await firstSave;
    });

    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(2));
    expect(mockApiObj.updateIssue).toHaveBeenNthCalledWith(
      2,
      "issue-1",
      expect.objectContaining({
        description: "Second local description",
        description_base: "First local description",
      }),
    );
  });

  it("ignores a late description callback after switching issues", async () => {
    const queryClient = createTestQueryClient();
    const issue2: Issue = {
      ...mockIssue,
      id: "issue-2",
      identifier: "TES-2",
      description: "Second issue description",
      revision: 8,
    };
    queryClient.setQueryData(["issues", "ws-1", "detail", "issue-2"], issue2);
    mockApiObj.getIssue.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "issue-2" ? issue2 : mockIssue),
    );

    let resolveFirst!: (issue: Issue) => void;
    const firstSave = new Promise<Issue>((resolve) => {
      resolveFirst = resolve;
    });
    mockApiObj.updateIssue
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ ...issue2, description: "Issue two draft", revision: 9 });

    const ui = (issueId: string) => (
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <QueryClientProvider client={queryClient}>
          <IssueDetail issueId={issueId} />
        </QueryClientProvider>
      </I18nProvider>
    );
    const { rerender } = render(ui("issue-1"));

    const issueOneEditor = await screen.findByDisplayValue("Add JWT auth to the backend");
    fireEvent.focus(issueOneEditor);
    fireEvent.change(issueOneEditor, {
      target: { value: "Issue one draft" },
    });
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(1));

    rerender(ui("issue-2"));
    const issueTwoEditor = await screen.findByDisplayValue("Second issue description");
    fireEvent.focus(issueTwoEditor);
    fireEvent.change(issueTwoEditor, {
      target: { value: "Issue two draft" },
    });
    await waitFor(() => expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(2));
    expect(mockApiObj.updateIssue).toHaveBeenNthCalledWith(
      2,
      "issue-2",
      expect.objectContaining({ description_base: "Second issue description" }),
    );

    await act(async () => {
      resolveFirst({ ...mockIssue, description: "Issue one draft", revision: 4 });
      await firstSave;
    });

    expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue("Issue two draft")).toBeVisible();
  });

  it("keeps a title draft visible when its captured content conflicts", async () => {
    mockApiObj.updateIssue.mockRejectedValueOnce({
      body: { code: "revision_conflict" },
    });
    renderIssueDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Implement authentication" }));
    const editor = await screen.findByTestId("title-editor");
    fireEvent.change(editor, { target: { value: "My local title" } });
    fireEvent.blur(editor);

    await waitFor(() =>
      expect(mockApiObj.updateIssue).toHaveBeenCalledWith(
        "issue-1",
        expect.objectContaining({
          title: "My local title",
          title_base: "Implement authentication",
        }),
      ),
    );
    expect(
      await screen.findByText("The title was changed concurrently. Compare both versions."),
    ).toBeVisible();
    expect(screen.getAllByText("My local title").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("My local title")).toBeVisible();
  });

  it("restores the server title when the user takes the latest version", async () => {
    mockApiObj.updateIssue.mockRejectedValueOnce({
      body: { code: "revision_conflict" },
    });
    renderIssueDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Implement authentication" }));
    const editor = await screen.findByTestId("title-editor");
    fireEvent.change(editor, { target: { value: "My local title" } });
    fireEvent.blur(editor);

    expect(
      await screen.findByText("The title was changed concurrently. Compare both versions."),
    ).toBeVisible();
    const callsBeforeDiscard = mockApiObj.updateIssue.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Use the latest version" }));

    await waitFor(() =>
      expect(
        screen.queryByText("The title was changed concurrently. Compare both versions."),
      ).not.toBeInTheDocument(),
    );
    // TitleEditor takes its text at mount, so the remount is what puts the
    // server title back — see titleResetToken.
    expect(await screen.findByDisplayValue("Implement authentication")).toBeVisible();
    // Taking the server version is local-only: the server already holds it.
    expect(mockApiObj.updateIssue).toHaveBeenCalledTimes(callsBeforeDiscard);
  });

  describe("sub-issues list", () => {
    beforeEach(() => {
      useSubIssueDisplayStore.setState({
        rowProperties: { ...DEFAULT_SUB_ISSUE_ROW_PROPERTIES },
        rowPropertyIds: [],
      });
    });

    const label = (id: string, name: string): Label => ({
      id,
      workspace_id: "ws-1",
      resource_type: "issue",
      name,
      color: "#3b82f6",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });

    const subIssue = (overrides: Partial<Issue>): Issue => ({
      ...mockIssue,
      parent_issue_id: "issue-1",
      assignee_type: null,
      assignee_id: null,
      due_date: null,
      priority: "none",
      ...overrides,
    });

    it("renders priority, labels, due date and nested progress on rows", async () => {
      mockApiObj.listChildIssues.mockResolvedValue({
        issues: [
          subIssue({
            id: "child-1",
            number: 11,
            identifier: "TES-11",
            title: "Fix login flow",
            priority: "urgent",
            labels: [label("l1", "backend"), label("l2", "auth")],
            // Past date-only value → overdue styling on an open issue.
            due_date: "2020-01-01",
          }),
          subIssue({
            id: "child-2",
            number: 12,
            identifier: "TES-12",
            title: "Ship dashboards",
          }),
        ],
      });
      mockApiObj.getChildIssueProgress.mockResolvedValue({
        progress: [{ parent_issue_id: "child-1", done: 1, total: 3 }],
      });

      renderIssueDetail();

      await screen.findByText("Fix login flow");
      // Label chips ride inside the row link.
      expect(screen.getByText("backend")).toBeInTheDocument();
      expect(screen.getByText("auth")).toBeInTheDocument();
      // Nested own-children progress for child-1 only (header shows 0/2).
      expect(await screen.findByText("1/3")).toBeInTheDocument();
      // Overdue open issue renders its due date in the destructive tone.
      const due = screen.getByText("Jan 1");
      expect(due.closest("span")?.className).toContain("text-destructive");
      // Bare row shows no due date / no progress chip of its own.
      const bareRow = screen.getByText("Ship dashboards").closest("a");
      expect(bareRow?.textContent).not.toContain("/");
    });

    it("hides fields the user toggled off in the display preference", async () => {
      useSubIssueDisplayStore.setState({
        rowProperties: {
          ...DEFAULT_SUB_ISSUE_ROW_PROPERTIES,
          labels: false,
          dueDate: false,
        },
      });
      mockApiObj.listChildIssues.mockResolvedValue({
        issues: [
          subIssue({
            id: "child-1",
            number: 11,
            identifier: "TES-11",
            title: "Fix login flow",
            labels: [label("l1", "backend")],
            due_date: "2020-01-01",
          }),
        ],
      });

      renderIssueDetail();

      await screen.findByText("Fix login flow");
      expect(screen.queryByText("backend")).not.toBeInTheDocument();
      expect(screen.queryByText("Jan 1")).not.toBeInTheDocument();
    });

    it("renders opted-in custom property chips on rows that carry a value", async () => {
      const estimate = {
        id: "prop-1",
        workspace_id: "ws-1",
        name: "Estimate",
        type: "text",
        config: {},
        position: 0,
        archived: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      mockApiObj.listProperties.mockResolvedValue({
        properties: [estimate],
        total: 1,
      });
      useSubIssueDisplayStore.setState({ rowPropertyIds: ["prop-1"] });
      mockApiObj.listChildIssues.mockResolvedValue({
        issues: [
          subIssue({
            id: "child-1",
            number: 11,
            identifier: "TES-11",
            title: "Fix login flow",
            properties: { "prop-1": "Sprint 3" },
          }),
          subIssue({
            id: "child-2",
            number: 12,
            identifier: "TES-12",
            title: "Ship dashboards",
          }),
        ],
      });

      renderIssueDetail();

      await screen.findByText("Fix login flow");
      // Chip renders only on the row that has a value for the property.
      expect(await screen.findByText("Sprint 3")).toBeInTheDocument();
      expect(screen.getAllByText("Sprint 3")).toHaveLength(1);
    });

    it("mutes the due date on done sub-issues even when past", async () => {
      mockApiObj.listChildIssues.mockResolvedValue({
        issues: [
          subIssue({
            id: "child-1",
            number: 11,
            identifier: "TES-11",
            title: "Wrapped up",
            status: "done",
            due_date: "2020-01-01",
          }),
        ],
      });

      renderIssueDetail();

      await screen.findByText("Wrapped up");
      const due = screen.getByText("Jan 1");
      expect(due.closest("span")?.className).not.toContain("text-destructive");
      expect(due.closest("span")?.className).toContain("text-muted-foreground");
    });
  });

});

describe("groupSubIssuesByStage", () => {
  const child = (id: string, stage: number | null): Issue => ({
    ...mockIssue,
    id,
    parent_issue_id: "parent-1",
    stage,
  });

  it("returns a single null-stage group when nothing is staged", () => {
    const groups = groupSubIssuesByStage([child("a", null), child("b", null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.stage).toBeNull();
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("orders staged groups ascending with the unstaged group last", () => {
    const groups = groupSubIssuesByStage([
      child("s2", 2),
      child("u", null),
      child("s1a", 1),
      child("s1b", 1),
    ]);
    expect(groups.map((g) => g.stage)).toEqual([1, 2, null]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["s1a", "s1b"]);
    expect(groups[2]?.items.map((i) => i.id)).toEqual(["u"]);
  });

  it("omits the unstaged group when every child is staged", () => {
    const groups = groupSubIssuesByStage([child("s1", 1), child("s2", 2)]);
    expect(groups.map((g) => g.stage)).toEqual([1, 2]);
  });
});
