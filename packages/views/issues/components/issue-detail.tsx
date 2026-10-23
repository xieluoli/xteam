"use client";

import {
  issueBehavesAs,
  issueBehavesAsAny,
  issueStatusCategory,
} from "@multica/core/issues";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type ReactNode } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { AppLink, useBackOrReplace } from "../../navigation";
import { IssueDuplicateBanner, IssueDuplicatesSection, isDuplicateIssue } from "./issue-duplicates";
import {
  Archive,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Milestone,
  MoreHorizontal,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  SlidersHorizontal,
  Tag,
  Unlink,
} from "lucide-react";
import { BreadcrumbHeader, type BreadcrumbSegment } from "../../layout/breadcrumb-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@multica/ui/components/ui/resizable";
import { Sheet, SheetContent } from "@multica/ui/components/ui/sheet";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { ContentEditor, type ContentEditorRef, TitleEditor, type TitleEditorRef, useFileDropZone, FileDropOverlay, useLazyEditor, useEditorUpload, PreviewSequenceProvider, collectPreviewSequence } from "../../editor";

import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@multica/ui/components/ui/tooltip";

import { Popover, PopoverTrigger, PopoverContent } from "@multica/ui/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { ActorAvatar } from "../../common/actor-avatar";
import { PropRow } from "../../common/prop-row";
import { PropertyIcon } from "../../common/property-icon";
import type { Attachment, Issue, IssueProperty, UpdateIssueRequest } from "@multica/core/types";
import { contentReferencesAttachment } from "@multica/core/types";
import { formatDateOnly, isPastDateOnly } from "@multica/core/issues/date";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import { toast } from "sonner";
import { errorCode } from "@multica/core/api";
import { StatusIcon } from "./status-icon";
import { PriorityIcon } from "./priority-icon";
import { StatusPicker } from "./pickers/status-picker";
import { PriorityPicker } from "./pickers/priority-picker";
import { StagePicker, maxSiblingStage } from "./pickers/stage-picker";
import { StartDatePicker } from "./pickers/start-date-picker";
import { DueDatePicker } from "./pickers/due-date-picker";
import { AssigneePicker } from "./pickers/assignee-picker";
import { LabelPicker } from "./pickers/label-picker";
import { CustomPropertyValueEditor, CustomPropertyValueDisplay } from "./pickers/custom-property-picker";
import { Switch } from "@multica/ui/components/ui/switch";
import { IssueActionsDropdown, useIssueActions, IssueActionsContextMenu, IssueContextMenuProvider } from "../actions";
import { LabelChip } from "../../labels/label-chip";
import { IssueAgentActivityIndicator } from "./issue-agent-activity-indicator";
import { ProjectPicker } from "../../projects/components/project-picker";
import { IssuePropertyPills } from "./issue-property-pills";
import { SourceContextBadge } from "./source-context-viewer";
import { RevisionConflictCompare } from "./revision-conflict-compare";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useCommentAnnotations } from "./use-comment-annotations";
import { CurrentIssueRenderContextProvider } from "../current-issue-render-context";
import { IssueWakeupHeaderChip } from "./issue-wakeup-header-chip";
import { WakeupsSection } from "./wakeups-section";
import { QuickActionsSection } from "./quick-actions-section";
import { PluginPanelSection } from "../../plugins";
import { PullRequestsSection } from "./pull-requests-section";
import { useGitHubSettings } from "@multica/core/github";
import { ImportedUsageSection } from "./imported-usage-section";
import { DeliverablesSection } from "./deliverables/deliverables-section";
import { DeliverablesOverview } from "./deliverables/deliverables-overview";
import {
  DESCRIPTION_BLOCK_ID,
  useDeliverableDetails,
} from "./deliverables/deliverable-details";
import { collectDeliverableFiles } from "@multica/core/attachments/deliverables";
import { AttachmentVersionsProvider } from "./deliverables/attachment-versions";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspacePaths } from "@multica/core/paths";
import { useActorName } from "@multica/core/workspace/hooks";
import { useWorkspaceId } from "@multica/core/hooks";
import { useRecentContextStore } from "@multica/core/chat";
import { issueListOptions, issueDetailOptions, childIssuesOptions, childIssueProgressOptions, issueAttachmentsOptions, issueTimelineOptions } from "@multica/core/issues/queries";
import { projectDetailOptions } from "@multica/core/projects/queries";
import { ProjectIcon } from "../../projects/components/project-icon";
import { issueLabelsOptions } from "@multica/core/labels";
import { propertyListOptions } from "@multica/core/properties";
import {
  useRecentIssuesStore,
  useSubIssuesCollapseStore,
  useSubIssueDisplayStore,
  SUB_ISSUE_ROW_PROPERTY_KEYS,
  type SubIssueRowProperties,
  type SubIssueRowPropertyKey,
} from "@multica/core/issues/stores";
import { useIssueSelectionStore } from "@multica/core/issues/stores/selection-store";
import { BatchActionToolbar } from "./batch-action-toolbar";
import { useIssueReactions } from "../hooks/use-issue-reactions";
import { ReactionBar } from "@multica/ui/components/common/reaction-bar";
import { useLocale } from "../../i18n";
import {
  useRestoredScrollOffset,
  useRestoredScrollRef,
} from "../../platform";
import { cn } from "@multica/ui/lib/utils";
import { PAGE_GUTTER } from "../../layout/page-header";

import { ProgressRing } from "./progress-ring";
import { useT } from "../../i18n";
import { useIssueDetailScrollRestore } from "../hooks/use-issue-detail-scroll-restore";
import { useInPageFind } from "../hooks/use-in-page-find";
import { FindBar } from "./find-bar";
import {
  AnimatedRightSidebar,
  getAnimatedRightSidebarInitialOpen,
  rightSidebarPanelMotionProps,
  useAnimatedRightSidebarState,
  useRightSidebarShortcut,
} from "../../layout/animated-right-sidebar";

/**
 * Memento entry recording that the comment-highlight deep link for this
 * issue already landed on the current route (value: the consumed comment
 * id). Lets a remount that merely restores the view (tab switch back) skip
 * the jump-and-highlight, while a fresh selection — which clears the entry
 * (see InboxPage.handleSelect) — runs it again.
 */
export function issueHighlightMementoKey(issueId: string): string {
  return `highlight:${issueId}`;
}

function shortDate(date: string | null, locale: string): string {
  if (!date) return "—";
  return formatDateOnly(date, { month: "short", day: "numeric" }, locale);
}

// ---------------------------------------------------------------------------
// Sidebar progressive disclosure
// ---------------------------------------------------------------------------
//
// Properties shown in the sidebar split into two groups:
//   - core: always rendered (status / assignee / project)
//   - optional: rendered only when the issue has a value for that field OR
//     the user explicitly added it via "+ Add property" in this session
//     (priority / due_date / labels)
//
// Parent is not in either group — it has its own standalone section below
// the Properties block, rendered only when the issue actually has a parent.
//
// `OPTIONAL_PROP_KEYS` is the open set — adding a new optional field
// means appending here, wiring its row in the JSX switch below, and
// adding a locale key. The picker, visibility rules, and add-property
// menu all flow from this one list.
// `stage` is only meaningful for a sub-issue (relative to its siblings), so
// its row and add-property entry are gated on `issue.parent_issue_id` at the
// render site below — it stays in this list so seeding/visibility flow through
// the same machinery as the other optional props.
const OPTIONAL_PROP_KEYS = ["priority", "stage", "start_date", "due_date", "labels"] as const;
type OptionalPropKey = (typeof OPTIONAL_PROP_KEYS)[number];

function isOptionalPropSet(
  issue: Issue,
  key: OptionalPropKey,
  attachedLabelsCount: number,
): boolean {
  switch (key) {
    case "priority":
      return issue.priority !== "none";
    case "stage":
      return issue.stage !== null && issue.stage !== undefined;
    case "start_date":
      return !!issue.start_date;
    case "due_date":
      return !!issue.due_date;
    case "labels":
      return attachedLabelsCount > 0;
  }
}

// groupSubIssuesByStage orders a parent's children for display: staged groups
// ascending by stage, then the unstaged group (stage === null) last. Callers
// render a per-group stage header only when the set is actually staged.
export function groupSubIssuesByStage(
  children: Issue[],
): { stage: number | null; items: Issue[] }[] {
  const byStage = new Map<number, Issue[]>();
  const unstaged: Issue[] = [];
  for (const c of children) {
    if (c.stage != null) {
      const arr = byStage.get(c.stage);
      if (arr) arr.push(c);
      else byStage.set(c.stage, [c]);
    } else {
      unstaged.push(c);
    }
  }
  const groups: { stage: number | null; items: Issue[] }[] = [...byStage.keys()]
    .sort((a, b) => a - b)
    .map((s) => ({ stage: s, items: byStage.get(s) as Issue[] }));
  if (unstaged.length > 0) groups.push({ stage: null, items: unstaged });
  return groups;
}

function SubIssueRow({
  child,
  childProgress,
  rowProps,
  customProperties,
}: {
  child: Issue;
  /** The sub-issue's OWN children progress (it can itself be a parent). */
  childProgress?: { done: number; total: number };
  /** User-level display preference: which built-in fields the row shows. */
  rowProps: SubIssueRowProperties;
  /** Workspace custom properties the user opted into showing on rows. */
  customProperties: IssueProperty[];
}) {
  const { t } = useT("issues");
  const locale = useLocale();
  const paths = useWorkspacePaths();
  const updateIssue = useUpdateIssue();
  const selected = useIssueSelectionStore((s) => s.selectedIds.has(child.id));
  const childStatusCatalog = useIssueStatuses(useWorkspaceId());
  const toggleSelected = useIssueSelectionStore((s) => s.toggle);
  // Category, not key: a custom status in the done/cancelled categories is
  // finished work and has to strike through like any other. (MUL-6243)
  const isDone = issueBehavesAsAny(child, ["done", "closed"]);
  const labels = rowProps.labels ? (child.labels ?? []) : [];
  const customPropsWithValue = customProperties.filter(
    (p) => child.properties?.[p.id] !== undefined,
  );

  const handleUpdate = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      updateIssue.mutate(
        {
          id: child.id,
          ...updates,
        },
        {
          onError: (err) =>
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : t(($) => $.detail.update_failed),
            ),
        },
      );
    },
    [child.id, updateIssue, t],
  );

  // AppLink wraps only the title/identifier area. Pickers and checkbox are
  // siblings, so their clicks never navigate — no stopPropagation acrobatics
  // and no risk of the native checkbox / picker triggers being blocked.
  // Right-click anywhere on the row opens the shared issue actions menu
  // (priority, labels, dates, delete, …) — the same menu as list rows.
  return (
    <IssueActionsContextMenu issue={child}>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50 transition-colors group/row",
          selected && "bg-accent/30",
        )}
      >
        {/* Priority ⇄ checkbox slot, mirroring the main list rows: the
            priority icon yields to the selection checkbox on hover/focus.
            Opacity (not display) swap keeps the checkbox keyboard-tabbable. */}
        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          {rowProps.priority && (
            <PriorityIcon
              priority={child.priority}
              className={cn(
                "transition-opacity",
                selected
                  ? "opacity-0"
                  : "group-hover/row:opacity-0 group-focus-within/row:opacity-0",
              )}
            />
          )}
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleSelected(child.id)}
            aria-label={t(($) => $.detail.select_sub_issue_aria, {
              identifier: child.identifier,
            })}
            className={cn(
              "absolute inset-0 cursor-pointer accent-primary transition-opacity",
              selected
                ? "opacity-100"
                : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
            )}
          />
        </div>
        <StatusPicker
          status={child.status}
          onUpdate={handleUpdate}
          align="start"
          trigger={
            <StatusIcon
              status={child.status}
              category={childStatusCatalog.categoryOf(child.status)}
              color={childStatusCatalog.colorOf(child.status)}
              icon={childStatusCatalog.iconOf(child.status)}
              className="h-[15px] w-[15px] shrink-0"
            />
          }
        />
        <AppLink
          href={paths.issueDetail(child.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <span className="text-micro text-muted-foreground tabular-nums font-medium shrink-0">
            {child.identifier}
          </span>
          <IssueAgentActivityIndicator issueId={child.id} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                "text-body truncate",
                isDone
                  ? "text-muted-foreground"
                  : "group-hover/row:text-foreground",
              )}
            >
              {child.title}
            </span>
            {labels.length > 0 && (
              <span className="hidden max-w-[200px] shrink-0 items-center gap-1 overflow-hidden md:inline-flex">
                {labels.slice(0, 2).map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))}
                {labels.length > 2 && (
                  <span className="text-micro text-muted-foreground">
                    +{labels.length - 2}
                  </span>
                )}
              </span>
            )}
            {customPropsWithValue.length > 0 && (
              <span className="hidden max-w-[260px] shrink-0 items-center gap-1 overflow-hidden md:inline-flex">
                {customPropsWithValue.slice(0, 3).map((property) => (
                  <span
                    key={property.id}
                    className="inline-flex max-w-[120px] items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground"
                  >
                    <PropertyIcon property={property} className="size-3 text-micro" />
                    <CustomPropertyValueDisplay
                      property={property}
                      value={child.properties?.[property.id]}
                    />
                  </span>
                ))}
              </span>
            )}
            {rowProps.childProgress && childProgress && childProgress.total > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5">
                <ProgressRing
                  done={childProgress.done}
                  total={childProgress.total}
                  size={11}
                />
                <span className="text-micro text-muted-foreground tabular-nums font-medium">
                  {childProgress.done}/{childProgress.total}
                </span>
              </span>
            )}
          </span>
        </AppLink>
        {rowProps.dueDate && child.due_date && (
          <DueDatePicker
            dueDate={child.due_date}
            onUpdate={handleUpdate}
            align="end"
            trigger={
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 text-caption tabular-nums",
                  !isDone && isPastDateOnly(child.due_date)
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                <CalendarDays className="size-3" />
                {shortDate(child.due_date, locale)}
              </span>
            }
          />
        )}
        {rowProps.assignee && (
          <AssigneePicker
            assigneeType={child.assignee_type}
            assigneeId={child.assignee_id}
            onUpdate={handleUpdate}
            align="end"
            trigger={
              child.assignee_type && child.assignee_id ? (
                <ActorAvatar
                  actorType={child.assignee_type}
                  actorId={child.assignee_id}
                  size="sm"
                  className="shrink-0"
                />
              ) : (
                <span
                  aria-hidden
                  className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 shrink-0"
                />
              )
            }
          />
        )}
      </div>
    </IssueActionsContextMenu>
  );
}

// ---------------------------------------------------------------------------
// SubIssueDisplayPopover — per-user "which properties do rows show" control
// ---------------------------------------------------------------------------

// Reuses the main Display panel's `card_*` labels — the property names are
// identical, so the sub-issues control needs no locale keys of its own.
const SUB_ISSUE_ROW_PROPERTY_LABEL_KEY: Record<
  SubIssueRowPropertyKey,
  "card_priority" | "card_labels" | "card_child_progress" | "card_due_date" | "card_assignee"
> = {
  priority: "card_priority",
  labels: "card_labels",
  childProgress: "card_child_progress",
  dueDate: "card_due_date",
  assignee: "card_assignee",
};

function SubIssueDisplayPopover({
  workspaceProperties,
}: {
  workspaceProperties: IssueProperty[];
}) {
  const { t } = useT("issues");
  const rowProperties = useSubIssueDisplayStore((s) => s.rowProperties);
  const rowPropertyIds = useSubIssueDisplayStore((s) => s.rowPropertyIds);
  const toggleRowProperty = useSubIssueDisplayStore((s) => s.toggleRowProperty);
  const toggleRowPropertyId = useSubIssueDisplayStore((s) => s.toggleRowPropertyId);

  return (
    <Popover>
      <Tooltip>
        <PopoverTrigger
          render={
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label={t(($) => $.display.tooltip)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              }
            />
          }
        />
        <TooltipContent side="bottom">{t(($) => $.display.tooltip)}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="px-3 py-2.5">
          <div className="space-y-2">
            {SUB_ISSUE_ROW_PROPERTY_KEYS.map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between"
              >
                <span className="text-body">
                  {t(($) => $.display[SUB_ISSUE_ROW_PROPERTY_LABEL_KEY[key]])}
                </span>
                <Switch
                  size="sm"
                  checked={rowProperties[key]}
                  onCheckedChange={() => toggleRowProperty(key)}
                />
              </label>
            ))}
            {workspaceProperties.map((property) => (
              <label
                key={property.id}
                className="flex cursor-pointer items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-body">
                  <PropertyIcon property={property} className="size-3.5 text-caption" />
                  <span className="truncate">{property.name}</span>
                </span>
                <Switch
                  size="sm"
                  checked={rowPropertyIds.includes(property.id)}
                  onCheckedChange={() => toggleRowPropertyId(property.id)}
                />
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IssueDetailProps {
  issueId: string;
  onDelete?: () => void;
  /** Called after the issue is marked as done via the toolbar button. */
  onDone?: () => void;
  defaultSidebarOpen?: boolean;
  layoutId?: string;
  /** Accepted for existing route callers; historical comments are not rendered. */
  highlightCommentId?: string;
  /**
   * Bump to replay the `highlightCommentId` landing on an already-mounted
   * detail. A remount replays it by itself (fresh mount, cleared memento
   * entry); this token is for the one path with neither remount nor
   * guaranteed re-render — re-clicking the notification row that is already
   * open (see InboxPage.handleSelect). The bump both re-arms the landing
   * guard and forces the render that re-reads the cleared memento entry.
   */
  highlightRequestToken?: number;
  /**
   * Far-left header slot, replacing the mobile sidebar trigger. A host that
   * embeds this detail one level deep (the inbox, on a phone) passes its own
   * "back" control here instead of stacking a second 48px bar above us — the
   * breadcrumb this header already renders names the issue's container, not
   * the surface the reader arrived from, so only the host can spell that trip.
   */
  leadingAction?: ReactNode;
  /**
   * `"peek"` renders the detail inside the board's side peek (`IssuePeekHost`):
   * a single column with the core properties as pills under the title, no
   * properties sidebar, and `trailingActions` where the sidebar toggle sits.
   */
  variant?: "page" | "peek";
  /** Peek only: host controls at the end of the header (open full page, close). */
  trailingActions?: ReactNode;
}

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

/**
 * Exported so `IssueDetailRoute` can render it for an identifier that names no
 * issue. The route must NOT fall through to `IssueDetail` in that case: doing
 * so mounts a second observer on the already-failed query, which refetches it
 * and restarts the resolve/remount cycle indefinitely.
 */
export function IssueNotFound({
  showBackLink = true,
  leading,
  trailing,
}: {
  showBackLink?: boolean;
  /**
   * Host-supplied way back, mirrored from `IssueDetailProps.leadingAction`. A
   * host that hands its whole screen to this component (the inbox, on a phone)
   * has no bar of its own left, so this state has to carry the trip back or
   * there is none.
   */
  leading?: ReactNode;
  /** Host controls at the end of the bar — the side peek's close button. */
  trailing?: ReactNode;
}) {
  const { t } = useT("issues");
  const backOrReplace = useBackOrReplace();
  const paths = useWorkspacePaths();

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {(leading || trailing) && (
        <div className={cn("flex h-12 shrink-0 items-center gap-2 border-b", PAGE_GUTTER)}>
          {leading}
          {trailing && <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>}
        </div>
      )}
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 text-body text-muted-foreground">
        <p>{t(($) => $.detail.not_found)}</p>
        {showBackLink && (
          <Button variant="outline" size="sm" onClick={() => backOrReplace(paths.issues())}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {t(($) => $.detail.back)}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/**
 * Exported so `IssueDetailRoute` can show the identical frame while it resolves
 * an identifier URL to its issue — the two waits are indistinguishable to the
 * user, and rendering the same skeleton keeps them that way.
 */
export function IssueDetailSkeleton({
  leading,
  trailing,
  sidebar = true,
}: { leading?: ReactNode; trailing?: ReactNode; sidebar?: boolean } = {}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* The way back is real from the first frame, not once the issue lands:
          a host that gave up its own bar for `leadingAction` has nothing else
          to offer while this skeleton owns the screen. */}
      <div className={cn("flex h-12 shrink-0 items-center gap-2 border-b", PAGE_GUTTER)}>
        {leading ?? (
          <>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-24" />
          </>
        )}
        {trailing && <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>}
      </div>
      <div className="flex flex-1 min-h-0">
        {/* Same scrollbar-gutter as the loaded scroller below, so the skeleton
            column doesn't shift sideways when real content mounts. */}
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
          {/* Gutters match the loaded column exactly (see its comment), so the
              skeleton doesn't reflow sideways when real content mounts. */}
          <div className="mx-auto w-full max-w-4xl px-3 py-6 space-y-6 md:px-8 md:py-8">
            <Skeleton className="h-8 w-3/4" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="h-px w-full" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              </div>
            </div>
          </div>
        </div>
        {sidebar && (
          <div className="hidden md:block w-80 border-l p-4 space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-16 shrink-0" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
            <Skeleton className="h-px w-full" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-16 shrink-0" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssueDetail
// ---------------------------------------------------------------------------

export function IssueDetail({ issueId, onDelete, onDone, defaultSidebarOpen = true, layoutId = "multica_issue_detail_layout", leadingAction, variant = "page", trailingActions }: IssueDetailProps) {
  const isPeek = variant === "peek";
  const { t } = useT("issues");
  const locale = useLocale();
  const id = issueId;
  const conclusionMutation = useUpdateIssue();
  const [conclusionDraft, setConclusionDraft] = useState<{ issueId: string; value: string } | null>(null);
  const [conclusionError, setConclusionError] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const paths = useWorkspacePaths();

  // Issue navigation — read from TQ list cache
  const wsId = useWorkspaceId();
  const { data: allIssues = [] } = useQuery(issueListOptions(wsId));
  const { getActorName } = useActorName();
  // Issue visuals use the catalog's custom geometry and color;
  // built-ins keep their fixed glyph and semantic token.
  const { categoryOf: resolveStatusCategory, colorOf: resolveStatusColor, iconOf: resolveStatusIcon } =
    useIssueStatuses(wsId);
  // Description autosave is deliberately NOT gated (no explicit submit; the
  // editor already strips `blob:` before serializing and binds ids on the
  // later save). It still needs the failure toast, or a failed upload just
  // erases its own placeholder and the file disappears unexplained.
  const { uploadWithToast } = useEditorUpload();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
  });
  const sidebarRef = usePanelRef();
  const isMobile = useIsMobile();
  const desktopSidebarInitialOpen = getAnimatedRightSidebarInitialOpen(
    defaultSidebarOpen,
    defaultLayout,
  );
  const {
    open: desktopSidebarOpen,
    visualOpen: desktopSidebarVisualOpen,
    motionEnabled: desktopSidebarMotionEnabled,
    beginToggle: beginDesktopSidebarToggle,
    handleResize: handleDesktopSidebarResize,
  } = useAnimatedRightSidebarState(desktopSidebarInitialOpen);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (isMobile) {
      setMobileSidebarOpen(false);
    }
  }, [isMobile]);
  const sidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [parentIssueOpen, setParentIssueOpen] = useState(true);
  const [pullRequestsOpen, setPullRequestsOpen] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const githubSettings = useGitHubSettings();

  // Per-issue, per-session set of optional properties currently visible in
  // the sidebar Properties section. Seeded on issue switch with whichever
  // fields are already set; "+ Add property" adds an entry, clearing a
  // value does *not* remove one (avoids row-flicker on edit → clear).
  // Resets when the user navigates to a different issue.
  const [visibleOptionalProps, setVisibleOptionalProps] = useState<Set<OptionalPropKey>>(
    () => new Set(),
  );
  // Same progressive-disclosure machinery for custom properties, keyed by
  // property definition id instead of a static key union.
  const [visibleCustomProps, setVisibleCustomProps] = useState<Set<string>>(() => new Set());
  const [autoOpenCustomProp, setAutoOpenCustomProp] = useState<string | null>(null);
  // Optional property to auto-open as soon as it's mounted (the user just
  // picked it from "+ Add property" and we want them dropped straight into
  // edit state). Consumed by the row that matches this key, cleared after.
  const [autoOpenProp, setAutoOpenProp] = useState<OptionalPropKey | null>(null);
  // Controlled state for the "+ Add property" popover. Base UI's Popover
  // doesn't auto-dismiss on item click (it's not a Menu primitive), so the
  // popover would stay open behind the newly auto-opened picker — two
  // popovers stacked. We close it explicitly in `addOptionalProp`.
  const [addPropPopoverOpen, setAddPropPopoverOpen] = useState(false);
  // Keep this issue's scroll container isolated from page and peek sessions.
  const [scrollContainerEl, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
  const scrollContainerKey = `${isPeek ? "peek" : "main"}:${id}`;
  const restoredScrollTop = useRestoredScrollOffset(scrollContainerKey);
  const restoreScrollRef = useRestoredScrollRef(scrollContainerKey);
  const rightSidebarShortcutTargetRef = useRef<HTMLDivElement | null>(null);
  const attachScrollContainer = useCallback(
    (el: HTMLDivElement | null) => {
      // The peek has no sidebar, so it must not claim the toggle shortcut.
      rightSidebarShortcutTargetRef.current = isPeek ? null : el;
      setScrollContainerEl(el);
      restoreScrollRef(el);
    },
    [isPeek, restoreScrollRef],
  );
  // Issue data from TQ — uses detail query, seeded from list cache if available.
  // Only seed when description is present; the list API omits it, so a partial
  // list row must not masquerade as a hydrated issue detail.
  const { data: issue = null, isLoading: issueLoading, refetch: refetchIssue } = useQuery({
    ...issueDetailOptions(wsId, id),
    // List rows and issue-created realtime payloads intentionally omit the
    // detail-only source-context snapshot. They can still seed this query via
    // initialData, so always reconcile with the authoritative detail endpoint
    // when the detail view mounts. Without this, the global Infinity staleTime
    // hides source context until a full page refresh.
    refetchOnMount: "always",
    initialData: () => {
      const cached = allIssues.find((i) => i.id === id);
      return cached?.description != null ? cached : undefined;
    },
  });
  const descriptionSourceId = `description:${id}`;
  const descriptionAnnotations = useCommentAnnotations({
    draftKey: `new:${id}`,
    sources: [{ id: descriptionSourceId, name: "Description", revision: issue?.revision }],
    enabled: !!user && !!issue,
    editable: true,
  });
  // Record recent visit
  const recordVisit = useRecentIssuesStore((s) => s.recordVisit);
  const recordRecentContext = useRecentContextStore((s) => s.recordVisit);
  useEffect(() => {
    if (issue) {
      recordVisit(wsId, issue.id);
      recordRecentContext(wsId, {
        type: "issue",
        id: issue.id,
        label: issue.identifier,
        subtitle: issue.title,
        status: issue.status,
      });
    }
  }, [issue?.id, wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire `onDelete` once when the issue transitions from loaded to missing.
  // Delete goes through a shell-level modal, so the caller (e.g. inbox) can't
  // be notified directly — instead, the detail page observes its own cache
  // clearing and runs the callback. We navigate via `onDeletedFallbackPath` on
  // the actions menu when no callback is supplied (standalone routes).
  const hadIssueRef = useRef(false);
  const firedDeleteCallbackRef = useRef(false);
  useEffect(() => {
    if (issue) {
      hadIssueRef.current = true;
      firedDeleteCallbackRef.current = false;
      return;
    }
    if (
      hadIssueRef.current &&
      !issueLoading &&
      !firedDeleteCallbackRef.current &&
      onDelete
    ) {
      firedDeleteCallbackRef.current = true;
      onDelete();
    }
  }, [issue, issueLoading, onDelete]);

  // Text edits are observed by the find hook's MutationObserver.
  const find = useInPageFind({
    container: scrollContainerEl,
    contentKey: id,
    enabled: !!issue,
  });
  // Close the bar (and drop highlights) when navigating to another issue —
  // the web route reuses this component instead of remounting.
  const closeFind = find.closeFind;
  useEffect(() => {
    closeFind();
  }, [id, closeFind]);

  const {
    reactions: issueReactions,
    toggleReaction: handleToggleIssueReaction,
  } = useIssueReactions(id, user?.id);

  // Attachments uploaded against this issue. Drives the description
  // editor's click-time fresh-sign download: NodeViews match
  // `src`/`href` against this list to resolve an attachment id before
  // calling `/api/attachments/{id}`.
  const { data: issueAttachments } = useQuery(issueAttachmentsOptions(id));

  // Sub-issue queries
  const parentIssueId = issue?.parent_issue_id;
  const { data: parentIssue = null } = useQuery({
    ...issueDetailOptions(wsId, parentIssueId ?? ""),
    enabled: !!parentIssueId,
    initialData: () => allIssues.find((i) => i.id === parentIssueId),
  });

  // Project segment in the breadcrumb. The issue's project_id is the source of
  // truth — same URL renders the same breadcrumb regardless of entry path.
  const issueProjectId = issue?.project_id;
  const { data: breadcrumbProject = null } = useQuery({
    ...projectDetailOptions(wsId, issueProjectId ?? ""),
    enabled: !!issueProjectId,
  });
  const {
    data: childIssues = [],
  } = useQuery({
    ...childIssuesOptions(wsId, id),
    enabled: !!issue,
  });
  // Whether this issue has sub-issues, as opposed to "we have not looked yet".
  // childIssuesOptions sets refetchOnMount: "always", so a cached snapshot is
  // re-fetched on every mount and isSuccess alone still describes the previous
  // visit. The unsubscribe control below picks a different server write from
  // this answer, so a defaulted or stale empty array must not count as "no
  // sub-issues" (MUL-5714).
  // Parent's children — used to render the "x/y" progress next to the
  // "Sub-issue of …" breadcrumb under the title.
  const { data: parentChildIssues = [] } = useQuery({
    ...childIssuesOptions(wsId, parentIssueId ?? ""),
    enabled: !!parentIssueId,
  });
  // Workspace-wide parent→(done/total) map; lets each sub-issue row show its
  // OWN nested progress ring without opening it. Same query the list
  // surfaces use, so it's usually already cached.
  const { data: subIssueProgress } = useQuery({
    ...childIssueProgressOptions(wsId),
    enabled: childIssues.length > 0,
  });
  // User-level display preference for sub-issue rows (built-in field toggles
  // + opted-in workspace custom properties). `subIssueCustomProps` resolves
  // the persisted ids against this workspace's live, non-archived property
  // definitions — ids from other workspaces or archived properties drop out.
  const subIssueRowProps = useSubIssueDisplayStore((s) => s.rowProperties);
  const subIssueRowPropertyIds = useSubIssueDisplayStore((s) => s.rowPropertyIds);
  // Store-backed (not useState) so the collapsed state survives leaving the
  // issue and navigating back within the session.
  const subIssuesCollapsed = useSubIssuesCollapseStore((s) =>
    s.collapsedIssueIds.has(issueId),
  );
  const setSubIssuesCollapsedFor = useSubIssuesCollapseStore(
    (s) => s.setCollapsed,
  );
  const setSubIssuesCollapsed = useCallback(
    (update: boolean | ((prev: boolean) => boolean)) => {
      const prev = useSubIssuesCollapseStore
        .getState()
        .collapsedIssueIds.has(issueId);
      setSubIssuesCollapsedFor(
        issueId,
        typeof update === "function" ? update(prev) : update,
      );
    },
    [issueId, setSubIssuesCollapsedFor],
  );

  // Selection store is global (workspace-scoped); clear it whenever this
  // issue detail is mounted or switched, so leftover selections from the
  // main list view (or another sub-issue list) don't leak into this one.
  const clearSelection = useIssueSelectionStore((s) => s.clear);
  const selectedIds = useIssueSelectionStore((s) => s.selectedIds);
  const selectIds = useIssueSelectionStore((s) => s.select);
  const deselectIds = useIssueSelectionStore((s) => s.deselect);
  useEffect(() => {
    clearSelection();
    return clearSelection;
  }, [id, clearSelection]);

  const childIssueIds = useMemo(() => childIssues.map((c) => c.id), [childIssues]);
  const childSelectedCount = childIssueIds.filter((cid) =>
    selectedIds.has(cid),
  ).length;
  const allChildrenSelected =
    childIssueIds.length > 0 && childSelectedCount === childIssueIds.length;
  const someChildrenSelected = childSelectedCount > 0;
  const handleToggleSelectAllChildren = useCallback(() => {
    if (allChildrenSelected) deselectIds(childIssueIds);
    else selectIds(childIssueIds);
  }, [allChildrenSelected, childIssueIds, deselectIds, selectIds]);

  const loading = issueLoading;

  const descEditorRef = useRef<ContentEditorRef>(null);
  const descriptionEditingRef = useRef(false);
  const descriptionSaveInFlightRef = useRef(false);
  const descriptionSaveIssueIdRef = useRef(id);
  const pendingDescriptionSaveRef = useRef<{
    markdown: string;
    baseMarkdown: string;
    attachmentIds: string[];
  } | null>(null);
  // Keep the description editor mounted from the start. Unlike the empty
  // composer shells, a long rendered description cannot swap between
  // react-markdown and ProseMirror without small per-block height differences
  // accumulating into a visible scroll/layout jump. The chunked Markdown path
  // keeps this single eager editor affordable; title and composers stay lazy.
  const titleEditorRef = useRef<TitleEditorRef>(null);
  const titleBaseRef = useRef<string | undefined>(issue?.title);
  const [titleConflictDraft, setTitleConflictDraft] = useState<string | null>(null);
  // Bumped when a conflicting title draft is discarded. TitleEditor reads its
  // text from `defaultValue` at mount and exposes no imperative setter, so
  // remounting is the only way to put the server's title back in the editor.
  const [titleResetToken, setTitleResetToken] = useState(0);
  useEffect(() => {
    setTitleConflictDraft(null);
    titleBaseRef.current = undefined;
    descriptionSaveInFlightRef.current = false;
    descriptionSaveIssueIdRef.current = id;
    pendingDescriptionSaveRef.current = null;
  }, [id]);
  const titleLazy = useLazyEditor({ editorRef: titleEditorRef, resetKey: id });
  const { isDragOver: descDragOver, dropZoneProps: descDropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((file) => descEditorRef.current?.uploadFile(file)),
  });
  // Pending uploads in the description editor. We don't pass `issueId` on
  // upload (to avoid orphaning attachments when the user deletes the file
  // from the markdown), so they start unattached and we re-bind them via
  // `attachment_ids` on the next description save. Drives editor previews
  // so text/code attachments show an Eye before the bind round-trips.
  const [descPendingAttachments, setDescPendingAttachments] = useState<Attachment[]>([]);
  const descPendingAttachmentsRef = useRef<Attachment[]>([]);
  // Memoized because the image sequence below keys off this array: without it
  // the concat branch hands a fresh reference to every render and rebuilds the
  // whole issue's sequence on each one.
  const descEditorAttachments = useMemo(
    () =>
      descPendingAttachments.length > 0
        ? [...(issueAttachments ?? []), ...descPendingAttachments]
        : issueAttachments,
    [issueAttachments, descPendingAttachments],
  );

  // Historical comments remain readable as attachment provenance, not as an editing surface.
  const { data: timeline = [] } = useQuery(issueTimelineOptions(id));

  // The files this issue has delivered as a whole: the sidebar section, the
  // overview grid, the viewer's info panel and the comments' version badges
  // all read this (MUL-7649).
  const previewSequence = useMemo(() => collectPreviewSequence([
    { id: DESCRIPTION_BLOCK_ID, content: issue?.description, attachments: descEditorAttachments, standalone: false },
    ...timeline.filter((entry) => entry.type === "comment").map((entry) => ({
      id: entry.id, content: entry.content, attachments: entry.attachments,
    })),
  ]), [issue?.description, descEditorAttachments, timeline]);

  const deliverableFiles = useMemo(() => collectDeliverableFiles(timeline), [timeline]);
  const commentById = useMemo(
    () =>
      new Map(
        timeline
          .filter((entry) => entry.type === "comment")
          .map((entry) => [entry.id, entry] as const),
      ),
    [timeline],
  );

  const describeDeliverable = useDeliverableDetails({
    files: deliverableFiles,
    commentById,
    onLocate: () => scrollContainerEl?.scrollTo({ top: 0, behavior: "smooth" }),
    canLocateComments: false,
  });
  // The overview remembers the file the viewer was showing, so `G` can go
  // back to it.
  const [overview, setOverview] = useState<{ open: boolean; returnKey: string | null }>({
    open: false,
    returnKey: null,
  });
  useEffect(() => {
    setOverview({ open: false, returnKey: null });
  }, [id]);
  const openOverview = useCallback(() => setOverview({ open: true, returnKey: null }), []);
  const openOverviewFromViewer = useCallback(
    (key: string) => setOverview({ open: true, returnKey: key }),
    [],
  );
  const closeOverview = useCallback(
    () => setOverview((current) => ({ ...current, open: false })),
    [],
  );

  const handleDescriptionUpload = useCallback(
    async (file: File) => {
      const result = await uploadWithToast(file);
      if (result) {
        descPendingAttachmentsRef.current = [
          ...descPendingAttachmentsRef.current,
          result,
        ];
        setDescPendingAttachments(descPendingAttachmentsRef.current);
      }
      return result;
    },
    [uploadWithToast],
  );

  useEffect(() => {
    descPendingAttachmentsRef.current = [];
    setDescPendingAttachments([]);
  }, [id]);

  // Shared issue actions (mutations, pin, copy-link, modal dispatch, etc.).
  // Called before the `if (!issue)` early return so hook order stays stable.
  const actions = useIssueActions(issue);
  const handleUpdateField = actions.updateField;

  // Labels live in their own query (not on the issue body) — fetch the count
  // here so seeding can decide whether the "Labels" optional row should be
  // shown for an issue that already has labels attached.
  const { data: attachedLabels = [] } = useQuery(issueLabelsOptions(wsId, id));
  const attachedLabelsCount = attachedLabels.length;

  // Custom property catalog. Includes archived definitions: an issue can
  // still carry a value written before the archive, and that row must stay
  // renderable (read-only) until someone clears it.
  const { data: workspaceProperties = [] } = useQuery(propertyListOptions(wsId, true));

  // Sub-issue rows only surface live definitions: the display picker offers
  // non-archived properties, and chips render only ids that resolve here.
  const activeWorkspaceProperties = useMemo(
    () => workspaceProperties.filter((p) => p.archived !== true),
    [workspaceProperties],
  );
  const subIssueCustomProps = useMemo(
    () =>
      subIssueRowPropertyIds
        .map((pid) => activeWorkspaceProperties.find((p) => p.id === pid))
        .filter((p): p is IssueProperty => !!p),
    [subIssueRowPropertyIds, activeWorkspaceProperties],
  );

  // Seed the visible-optional-props set:
  //   - on issue switch, reset to whichever fields are currently set
  //   - on the SAME issue, additively pick up fields the user just set
  //     (so the row stays visible after they edit + clear in one session)
  // Removal happens only on issue switch — never on clear.
  const seededIssueIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!issue) return;
    if (seededIssueIdRef.current !== issue.id) {
      seededIssueIdRef.current = issue.id;
      setAutoOpenProp(null);
      setAutoOpenCustomProp(null);
      const seed = new Set<OptionalPropKey>();
      for (const k of OPTIONAL_PROP_KEYS) {
        if (isOptionalPropSet(issue, k, attachedLabelsCount)) seed.add(k);
      }
      setVisibleOptionalProps(seed);
      setVisibleCustomProps(new Set(Object.keys(issue.properties ?? {})));
      return;
    }
    setVisibleOptionalProps((prev) => {
      let next = prev;
      for (const k of OPTIONAL_PROP_KEYS) {
        if (isOptionalPropSet(issue, k, attachedLabelsCount) && !next.has(k)) {
          if (next === prev) next = new Set(prev);
          next.add(k);
        }
      }
      return next;
    });
    setVisibleCustomProps((prev) => {
      let next = prev;
      for (const propertyId of Object.keys(issue.properties ?? {})) {
        if (!next.has(propertyId)) {
          if (next === prev) next = new Set(prev);
          next.add(propertyId);
        }
      }
      return next;
    });
  }, [issue, attachedLabelsCount]);

  const addOptionalProp = useCallback(
    (key: OptionalPropKey) => {
      setVisibleOptionalProps((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setAutoOpenProp(key);
      // Dismiss the "+ Add property" popover so it doesn't sit stacked
      // behind the picker we're about to auto-open.
      setAddPropPopoverOpen(false);
    },
    [],
  );

  const addCustomProp = useCallback((propertyId: string) => {
    setVisibleCustomProps((prev) => {
      if (prev.has(propertyId)) return prev;
      const next = new Set(prev);
      next.add(propertyId);
      return next;
    });
    setAutoOpenCustomProp(propertyId);
    setAddPropPopoverOpen(false);
  }, []);

  // Clear the auto-open flag after the next render so pickers (which read
  // `defaultOpen` once via a useState initializer) keep the open state they
  // captured on mount, but later interactions don't re-trigger it.
  useEffect(() => {
    if (autoOpenProp === null) return;
    setAutoOpenProp(null);
  }, [autoOpenProp]);

  useEffect(() => {
    if (autoOpenCustomProp === null) return;
    setAutoOpenCustomProp(null);
  }, [autoOpenCustomProp]);

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen((open) => !open);
      return;
    }

    const panel = sidebarRef.current;
    if (!panel) return;
    const nextOpen = panel.isCollapsed();
    beginDesktopSidebarToggle(nextOpen);
    window.requestAnimationFrame(() => {
      if (nextOpen) panel.expand();
      else panel.collapse();
    });
  }, [beginDesktopSidebarToggle, isMobile, sidebarRef]);

  // The header's wakeup chip opens the sidebar and brings the Wakeups section
  // into view with focus on its heading.
  const openWakeups = useCallback(() => {
    if (!sidebarOpen) handleToggleSidebar();
    window.requestAnimationFrame(() => {
      const heading = document.getElementById(`issue-wakeups-${id}`);
      heading?.scrollIntoView({ block: "nearest" });
      heading?.focus({ preventScroll: true });
    });
  }, [handleToggleSidebar, id, sidebarOpen]);

  useRightSidebarShortcut(rightSidebarShortcutTargetRef, handleToggleSidebar);

  useIssueDetailScrollRestore({
    restoreKey: `${wsId}:${id}`,
    scrollContainerEl,
    ready: !!issue && !loading,
    disabled: isPeek,
    // The tab memento's offset, when the platform serves one. It must win
    // over this hook's module-level map — see the parameter doc.
    overrideTop: restoredScrollTop,
  });

  // Keep the identity value stable across unrelated issue-detail updates so
  // context consumers only re-render when the owning issue changes identity.
  const resolvedIssueId = issue?.id;
  const resolvedIssueIdentifier = issue?.identifier;
  const currentIssueRenderContext = useMemo(
    () =>
      resolvedIssueId && resolvedIssueIdentifier
        ? { id: resolvedIssueId, identifier: resolvedIssueIdentifier }
        : null,
    [resolvedIssueId, resolvedIssueIdentifier],
  );

  if (loading) {
    // The host's trailing controls hold the peek's only close button, so the
    // waiting and missing states carry them too.
    return <IssueDetailSkeleton leading={leadingAction} trailing={trailingActions} sidebar={!isPeek} />;
  }

  if (!issue) {
    return <IssueNotFound showBackLink={!onDelete} leading={leadingAction} trailing={trailingActions} />;
  }

  const persistDescriptionSave = (
    draft: { markdown: string; baseMarkdown: string; attachmentIds: string[] },
  ) => {
    descriptionSaveInFlightRef.current = true;
    handleUpdateField(
      {
        description: draft.markdown,
        description_base: draft.baseMarkdown,
        attachment_ids:
          draft.attachmentIds.length > 0 ? draft.attachmentIds : undefined,
      },
      {
        onSuccess: (serverIssue) => {
          if (descriptionSaveIssueIdRef.current !== id) return;
          descriptionSaveInFlightRef.current = false;
          const pending = pendingDescriptionSaveRef.current;
          pendingDescriptionSaveRef.current = null;
          if (pending) {
            // Usually the accepted document is exactly what we submitted. If
            // the server appended late channel media, keep the submitted body
            // as the next editor baseline: the server can recognize that the
            // only delta is media the editor never saw and preserve it again.
            const nextBase = serverIssue.description === draft.markdown
              ? serverIssue.description
              : draft.markdown;
            persistDescriptionSave({ ...pending, baseMarkdown: nextBase });
          }
        },
        onError: () => {
          if (descriptionSaveIssueIdRef.current !== id) return;
          descriptionSaveInFlightRef.current = false;
          pendingDescriptionSaveRef.current = null;
        },
      },
    );
  };

  const queueDescriptionSave = (
    draft: { markdown: string; baseMarkdown: string; attachmentIds: string[] },
  ) => {
    if (descriptionSaveInFlightRef.current) {
      pendingDescriptionSaveRef.current = draft;
      return;
    }
    persistDescriptionSave(draft);
  };

  const sidebarContent = (
    <div className="space-y-5">
      {/* Properties */}
      <div>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors mb-2 hover:bg-accent/70 ${propertiesOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setPropertiesOpen(!propertiesOpen)}
        >
          {t(($) => $.detail.section_properties)}
          <ChevronRight className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${propertiesOpen ? "rotate-90" : ""}`} />
        </button>
        {propertiesOpen && <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">
          {/* Core props — always rendered. */}
          <PropRow label={t(($) => $.detail.prop_status)}>
            <StatusPicker
              status={issue.status}
              onUpdate={handleUpdateField}
              align="start"
              onMarkDuplicate={actions.openMarkDuplicate}
              isDuplicate={isDuplicateIssue(issue)}
            />
          </PropRow>
          <PropRow label={t(($) => $.detail.prop_assignee)}>
            <AssigneePicker assigneeType={issue.assignee_type} assigneeId={issue.assignee_id} onUpdate={handleUpdateField} align="start" />
          </PropRow>
          <PropRow label={t(($) => $.detail.prop_project)}>
            <ProjectPicker
              projectId={issue.project_id}
              onUpdate={handleUpdateField}
            />
          </PropRow>

          {/* Optional props — rendered only when set on the issue OR added
              via "+ Add property" in this session. Row order follows the
              order of `OPTIONAL_PROP_KEYS`. */}
          {visibleOptionalProps.has("priority") && (
            <PropRow label={t(($) => $.detail.prop_priority)}>
              <PriorityPicker
                priority={issue.priority}
                onUpdate={handleUpdateField}
                align="start"
                defaultOpen={autoOpenProp === "priority"}
              />
            </PropRow>
          )}
          {issue.parent_issue_id != null && visibleOptionalProps.has("stage") && (
            <PropRow label={t(($) => $.detail.prop_stage)}>
              <StagePicker
                stage={issue.stage}
                onUpdate={handleUpdateField}
                maxStage={maxSiblingStage(parentChildIssues)}
                align="start"
                defaultOpen={autoOpenProp === "stage"}
              />
            </PropRow>
          )}
          {visibleOptionalProps.has("start_date") && (
            <PropRow label={t(($) => $.detail.prop_start_date)}>
              <StartDatePicker
                startDate={issue.start_date}
                onUpdate={handleUpdateField}
                defaultOpen={autoOpenProp === "start_date"}
              />
            </PropRow>
          )}
          {visibleOptionalProps.has("due_date") && (
            <PropRow label={t(($) => $.detail.prop_due_date)}>
              <DueDatePicker
                dueDate={issue.due_date}
                onUpdate={handleUpdateField}
                defaultOpen={autoOpenProp === "due_date"}
              />
            </PropRow>
          )}
          {visibleOptionalProps.has("labels") && (
            <PropRow label={t(($) => $.detail.prop_labels)}>
              <LabelPicker
                issueId={issue.id}
                align="start"
                defaultOpen={autoOpenProp === "labels"}
              />
            </PropRow>
          )}

          {/* Custom properties — same progressive disclosure as the
              built-in optional props: a row renders when the issue has a
              value OR the user added the property this session. Archived
              definitions render read-only until their value is cleared. */}
          {workspaceProperties
            .filter(
              (p) =>
                issue.properties?.[p.id] !== undefined ||
                (!p.archived && visibleCustomProps.has(p.id)),
            )
            .map((p) => (
              <PropRow
                key={p.id}
                label={
                  <>
                    <PropertyIcon property={p} className="size-3.5 text-caption" />
                    <span className="truncate">{p.name}</span>
                  </>
                }
              >
                <CustomPropertyValueEditor
                  issue={issue}
                  property={p}
                  defaultOpen={autoOpenCustomProp === p.id}
                />
              </PropRow>
            ))}

          {/* "+ Add property" — opens a Popover listing optional fields
              not yet displayed. Hidden once every optional field is on
              screen. Sits inside the same grid as a full-row, with its
              own padding so the visual rhythm follows the rows above. */}
          {(OPTIONAL_PROP_KEYS.some((k) => !visibleOptionalProps.has(k) && (k !== "stage" || issue.parent_issue_id != null)) ||
            workspaceProperties.some((p) => !p.archived && !visibleCustomProps.has(p.id) && issue.properties?.[p.id] === undefined)) && (
            <div className="col-span-2 mt-1">
              <Popover open={addPropPopoverOpen} onOpenChange={setAddPropPopoverOpen}>
                <PopoverTrigger
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 -mx-2 text-caption text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  <span>{t(($) => $.detail.add_property_action)}</span>
                </PopoverTrigger>
                {/* Item visuals mirror the inspector rows' typography
                    (text-caption, muted icons) and each option leads with the
                    icon the resulting picker uses, so the dropdown reads
                    as a preview of what will show up below. */}
                <PopoverContent align="start" className="w-44 p-1">
                  {OPTIONAL_PROP_KEYS.filter((k) => !visibleOptionalProps.has(k) && (k !== "stage" || issue.parent_issue_id != null)).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => addOptionalProp(k)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-caption text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      {k === "priority" && (
                        <PriorityIcon priority="medium" inheritColor className="text-muted-foreground" />
                      )}
                      {k === "stage" && (
                        <Milestone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {k === "start_date" && (
                        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {k === "due_date" && (
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {k === "labels" && (
                        <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">
                        {k === "priority" && t(($) => $.detail.prop_priority)}
                        {k === "stage" && t(($) => $.detail.prop_stage)}
                        {k === "start_date" && t(($) => $.detail.prop_start_date)}
                        {k === "due_date" && t(($) => $.detail.prop_due_date)}
                        {k === "labels" && t(($) => $.detail.prop_labels)}
                      </span>
                    </button>
                  ))}
                  {(() => {
                    const addable = workspaceProperties.filter(
                      (p) =>
                        !p.archived &&
                        !visibleCustomProps.has(p.id) &&
                        issue.properties?.[p.id] === undefined,
                    );
                    if (addable.length === 0) return null;
                    return (
                      <>
                        <div className="my-1 h-px bg-border" />
                        {addable.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addCustomProp(p.id)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-caption text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                          >
                            {p.icon ? (
                              <PropertyIcon property={p} className="size-3.5 text-caption" />
                            ) : (
                              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{p.name}</span>
                          </button>
                        ))}
                      </>
                    );
                  })()}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>}
      </div>

      {/* Quick actions — the sidebar's only "do something" block, so it sits
          directly under Properties and above every read-only section. Renders
          nothing when the workspace has no active action visible to this
          member. It is NOT filtered by invoke permission: a member can see and
          click an action they cannot run, and the refusal is explained at run
          time rather than by a silently shorter list. */}
      <QuickActionsSection issueId={issue.id} />
      <WakeupsSection
        issueId={issue.id}
        closed={["done", "closed"].includes(resolveStatusCategory(issue.status))}
        defaultAgentId={issue.assignee_type === "agent" ? (issue.assignee_id ?? undefined) : undefined}
      />
      <PluginPanelSection issueId={issue.id} />

      {/* Parent issue — standalone section, only when the issue has a
          parent. Setting a parent is reachable via the issue actions menu;
          this card surfaces an existing parent without occupying sidebar
          space for issues that don't have one. */}
      {parentIssue && (
        <div>
          <button
            type="button"
            className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors mb-2 hover:bg-accent/70 ${parentIssueOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setParentIssueOpen(!parentIssueOpen)}
          >
            {t(($) => $.detail.section_parent_issue)}
            <ChevronRight className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${parentIssueOpen ? "rotate-90" : ""}`} />
          </button>
          {parentIssueOpen && <div className="pl-2">
            <div className="flex items-center gap-0.5 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors group">
              <AppLink
                href={paths.issueDetail(parentIssue.id)}
                className="flex flex-1 min-w-0 items-center gap-1.5 py-1.5 text-caption"
              >
                <StatusIcon
                  status={parentIssue.status}
                  color={resolveStatusColor(parentIssue.status)}
                  icon={resolveStatusIcon(parentIssue.status)}
                  category={issueStatusCategory(parentIssue) ?? undefined}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="text-muted-foreground shrink-0">{parentIssue.identifier}</span>
                <span className="truncate group-hover:text-foreground">{parentIssue.title}</span>
              </AppLink>
              <button
                type="button"
                title={t(($) => $.actions.remove_parent_issue)}
                aria-label={t(($) => $.actions.remove_parent_issue)}
                onClick={() => actions.removeParent()}
                className="shrink-0 rounded-xs p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>}
        </div>
      )}

      <IssueDuplicatesSection issueId={issue.id} />
      <ImportedUsageSection issueId={issue.id} />

      {/* Pull requests — hidden when the workspace disables the PR sidebar
          (or the GitHub master switch is off). Backend data is kept either
          way so re-enabling restores the section instantly. */}
      {githubSettings.prSidebar && (
        <PullRequestsSection
          issueId={id}
          identifier={issue.identifier}
          open={pullRequestsOpen}
          onOpenChange={setPullRequestsOpen}
        />
      )}

      {/* Deliverables — the files this issue's comments delivered. Hidden
          while there are none. */}
      <DeliverablesSection files={deliverableFiles} onOpenOverview={openOverview} />

      {/* Details — creator and timestamps. Last in the sidebar: the least-read
          block, since the values never change once the issue exists. */}
      <div>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors mb-2 hover:bg-accent/70 ${detailsOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          {t(($) => $.detail.section_details)}
          <ChevronRight className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${detailsOpen ? "rotate-90" : ""}`} />
        </button>
        {detailsOpen && <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">
          <PropRow label={t(($) => $.detail.prop_created_by)}>
            <ActorAvatar actorType={issue.creator_type} actorId={issue.creator_id} size="sm" enableHoverCard />
            <span className="cursor-pointer truncate">{getActorName(issue.creator_type, issue.creator_id)}</span>
          </PropRow>
          <PropRow label={t(($) => $.detail.prop_created)}>
            <span className="text-muted-foreground">{shortDate(issue.created_at, locale)}</span>
          </PropRow>
          <PropRow label={t(($) => $.detail.prop_updated)}>
            <span className="text-muted-foreground">{shortDate(issue.updated_at, locale)}</span>
          </PropRow>
        </div>}
      </div>

      {/* The standalone "Token usage" section that used to sit here is gone:
          it showed the same issue totals the execution-log header now carries,
          minus the cost and minus any way to tell which run spent them. Its
          every field (input / output / cache / run count) lives in the usage
          dialog that header opens. The `/api/issues/:id/usage` endpoint it
          read stays — the CLI's `issue usage` command still uses it. */}

      {/* Metadata — agent-facing free-form KV bag. The values almost
          never mean anything to humans, so the trigger row matches the
          sibling section headers (Pull requests / Details / Parent issue)
          but clicking opens a dialog with the raw JSON instead of expanding
          inline — the payload can be large and pushing the rest of the
          sidebar down was noisy. */}
      {Object.keys(issue.metadata ?? {}).length > 0 && (
        <>
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            onClick={() => setMetadataOpen(true)}
          >
            {t(($) => $.detail.section_metadata)}
            <span className="tabular-nums">
              · {Object.keys(issue.metadata ?? {}).length}
            </span>
          </button>
          <Dialog open={metadataOpen} onOpenChange={setMetadataOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t(($) => $.detail.section_metadata)}</DialogTitle>
              </DialogHeader>
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-caption">
                {JSON.stringify(issue.metadata ?? {}, null, 2)}
              </pre>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );

  // Breadcrumb shows the single most-direct container, never a fabricated chain.
  // project_id and parent_issue_id are orthogonal (a sub-issue can live in a
  // different project than its parent), so we never render both: parent wins,
  // else project, else nothing. The project is still shown in the properties
  // panel. The workspace name is intentionally absent — "all issues" is a view,
  // not a container.
  const breadcrumbSegments: BreadcrumbSegment[] = parentIssue
    ? [{ href: paths.issueDetail(parentIssue.id), label: parentIssue.identifier }]
    : breadcrumbProject
      ? [
          {
            href: paths.projectDetail(breadcrumbProject.id),
            className: "flex items-center gap-1 min-w-0 max-w-72",
            label: (
              <>
                <ProjectIcon project={breadcrumbProject} size="sm" />
                <span className="min-w-0 truncate">{breadcrumbProject.title}</span>
              </>
            ),
          },
        ]
      : [];

  const titleSizeClass = isPeek ? "text-title-lg font-semibold" : "text-display-sm font-bold";

  const detailContent = (
    <CurrentIssueRenderContextProvider value={currentIssueRenderContext}>
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
        {/* Find stays outside the scroll container so its own text is excluded. */}
        {find.open && (
          <FindBar
            find={find}
            className={cn("absolute top-14 z-30", isMobile ? "right-4" : "right-10")}
          />
        )}
        <BreadcrumbHeader
          leading={leadingAction}
          segments={breadcrumbSegments}
          leaf={
            <AppLink
              href={paths.issueDetail(issue.id)}
              className="flex min-w-0 transition-opacity hover:opacity-80"
            >
              <span className="truncate font-medium text-foreground">
                {isPeek ? issue.identifier : `${issue.identifier} ${issue.title}`}
              </span>
            </AppLink>
          }
          actions={
            <>
            <IssueWakeupHeaderChip issueId={id} onOpen={openWakeups} />
            {onDone && !issueBehavesAsAny(issue, ["done", "closed"]) && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => { handleUpdateField({ status: "done" }); onDone?.(); }}
                    >
                      <CircleCheck />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">{t(($) => $.detail.mark_done_tooltip)}</TooltipContent>
              </Tooltip>
            )}
            {onDone && issueBehavesAs(issue, "done") && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => { onDone(); }}
                    >
                      <Archive />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">{t(($) => $.detail.archive_tooltip)}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn("text-muted-foreground", actions.isPinned && "text-foreground")}
                    onClick={actions.togglePin}
                  >
                    {actions.isPinned ? <PinOff /> : <Pin />}
                  </Button>
                }
              />
              <TooltipContent side="bottom">{actions.isPinned ? t(($) => $.detail.unpin_tooltip) : t(($) => $.detail.pin_tooltip)}</TooltipContent>
            </Tooltip>
            <IssueActionsDropdown
              issue={issue}
              align="end"
              // When a parent passes `onDelete`, we detect deletion via effect
              // above and skip navigation. Otherwise the modal takes us back
              // to the list we came from, falling back to all issues.
              onDeletedFallbackPath={onDelete ? undefined : paths.issues()}
              trigger={
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <MoreHorizontal />
                </Button>
              }
            />
            {isPeek ? (
              trailingActions
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={sidebarOpen ? "secondary" : "ghost"}
                      size="icon-sm"
                      className={sidebarOpen ? "" : "text-muted-foreground"}
                      onClick={handleToggleSidebar}
                    >
                      <PanelRight />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">{t(($) => $.detail.sidebar_tooltip)}</TooltipContent>
              </Tooltip>
            )}
            </>
          }
        />

        {/* scrollbar-gutter both-edges: with classic (space-taking) scrollbars —
            macOS with a mouse or "always show", Windows, Linux — the global
            `scrollbar-width: thin` carves ~11px off the right side only, so the
            centered column reads 32px left vs 43px right (MUL-4404). Mirroring
            the gutter restores symmetry; overlay-scrollbar platforms reserve
            nothing and render unchanged. */}
        <div
          ref={attachScrollContainer}
          data-tab-scroll-root={isPeek ? undefined : scrollContainerKey}
          className="relative flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
        >
        {/* Gutters: 32px is a comfortable reading margin on a desktop column
            but eats 16% of a 393px phone, so below `md` they drop to 12px.
            `max-md:pb-chat-launcher` reserves the launcher's corner at the end
            of the scroll: below `md` the composer is not pinned (see
            `useStickyComposer`), so it lands here — right where the launcher
            floats — once the reader scrolls to the bottom. */}
        <div
          className={cn(
            "mx-auto w-full",
            // The peek is already a narrow column, so it takes a tighter gutter
            // and never reaches the chat launcher's corner (see IssuePeekHost).
            isPeek ? "px-6 py-5" : "max-w-4xl px-3 py-6 max-md:pb-chat-launcher md:px-8 md:py-8",
          )}
        >
          <IssueDuplicateBanner
            issue={issue}
            onUnmark={() =>
              handleUpdateField(
                { status: "todo" },
                { onSuccess: () => toast.success(t(($) => $.duplicates.unmark_toast)) },
              )
            }
          />
          {titleLazy.active && (
            <div className={titleLazy.ready ? undefined : "hidden"}>
              <TitleEditor
                key={`title-${id}-${titleResetToken}`}
                ref={titleEditorRef}
                defaultValue={titleConflictDraft ?? issue.title}
                placeholder={t(($) => $.detail.title_placeholder)}
                className={cn("w-full leading-snug tracking-tight", titleSizeClass)}
                onReady={titleLazy.onReady}
                onBlur={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== issue.title) {
                    handleUpdateField({
                      title: trimmed,
                      title_base: titleBaseRef.current,
                    }, {
                      onSuccess: (serverIssue) => {
                        setTitleConflictDraft(null);
                        titleBaseRef.current = serverIssue.title;
                      },
                      onError: (error) => {
                        if (errorCode(error) === "revision_conflict") {
                          setTitleConflictDraft(trimmed);
                        }
                      },
                    });
                  }
                }}
              />
            </div>
          )}
          {!titleLazy.ready && (
            <div
              role="button"
              tabIndex={0}
              className={cn("w-full cursor-text leading-snug tracking-tight", titleSizeClass)}
              onClick={(e) => {
                // A drag-selection (copying the title) must not summon the editor.
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) return;
                titleBaseRef.current = issue.title;
                titleLazy.activate({ x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  titleBaseRef.current = issue.title;
                  titleLazy.activate();
                }
              }}
            >
              {issue.title}
            </div>
          )}
          {titleConflictDraft !== null ? (
            <RevisionConflictCompare
              className="mt-2"
              title={t(($) => $.revision.compare_title)}
              serverLabel={t(($) => $.revision.server_version)}
              localLabel={t(($) => $.revision.local_version)}
              serverValue={issue.title}
              localValue={titleConflictDraft}
              serverAction={(
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // Local-only: the server already holds this title, so
                    // discarding writes nothing. The remount is what puts it
                    // back into the editor (see titleResetToken).
                    setTitleConflictDraft(null);
                    titleBaseRef.current = issue.title;
                    setTitleResetToken((token) => token + 1);
                  }}
                >
                  {t(($) => $.revision.use_server)}
                </Button>
              )}
              localAction={(
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const draft = titleConflictDraft.trim();
                    if (!draft) return;
                    handleUpdateField(
                      { title: draft, title_base: issue.title },
                      {
                        onSuccess: (serverIssue) => {
                          setTitleConflictDraft(null);
                          titleBaseRef.current = serverIssue.title;
                        },
                      },
                    );
                  }}
                >
                  {t(($) => $.revision.keep_local)}
                </Button>
              )}
            />
          ) : null}

          {parentIssue && !issue.source_context && (
            <AppLink
              href={paths.issueDetail(parentIssue.id)}
              className="mt-2 inline-flex max-w-full items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground transition-colors group/parent"
            >
              <span className="font-medium shrink-0">{t(($) => $.detail.sub_issue_of)}</span>
              <StatusIcon
                  status={parentIssue.status}
                  color={resolveStatusColor(parentIssue.status)}
                  icon={resolveStatusIcon(parentIssue.status)}
                  category={issueStatusCategory(parentIssue) ?? undefined}
                  className="h-3.5 w-3.5 shrink-0"
                />
              <span className="tabular-nums shrink-0">{parentIssue.identifier}</span>
              <span className="truncate group-hover/parent:text-foreground">
                {parentIssue.title}
              </span>
              {parentChildIssues.length > 0 && (() => {
                const done = parentChildIssues.filter((c) => issueBehavesAs(c, "done")).length;
                return (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 shrink-0">
                    <ProgressRing done={done} total={parentChildIssues.length} size={11} />
                    <span className="tabular-nums text-micro font-medium">
                      {done}/{parentChildIssues.length}
                    </span>
                  </span>
                );
              })()}
            </AppLink>
          )}

          {isPeek && (
            <div className="mt-3">
              <IssuePropertyPills
                issue={issue}
                onUpdate={handleUpdateField}
                onMarkDuplicate={actions.openMarkDuplicate}
                isDuplicate={isDuplicateIssue(issue)}
              />
            </div>
          )}

          {issue.source_context && (
            <SourceContextBadge
              context={issue.source_context}
              parentIssue={parentIssue}
              parentProgress={parentChildIssues.length > 0
                ? {
                    done: parentChildIssues.filter((child) => issueBehavesAs(child, "done")).length,
                    total: parentChildIssues.length,
                  }
                : undefined}
              refetchIssue={async () => {
                const result = await refetchIssue();
                return result.isError ? null : result.data;
              }}
            />
          )}

          <div
            {...descDropZoneProps}
            {...descriptionAnnotations.captureProps}
            ref={descriptionAnnotations.cardRef}
            className="relative mt-5 rounded-lg"
            onFocusCapture={() => {
              if (!descriptionEditingRef.current) {
                descriptionEditingRef.current = true;
              }
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                descriptionEditingRef.current = false;
              }
            }}
          >
            {descriptionAnnotations.popup}
            <div data-comment-content={descriptionSourceId}>
              <ContentEditor
                ref={descEditorRef}
                key={id}
                value={issue.description ?? ""}
                placeholder={t(($) => $.detail.desc_placeholder)}
                onUpdate={(md, baseMarkdown) => {
                  // Bind any pending uploads still referenced in the markdown
                  // so they appear in `issueAttachments` after refresh and the
                  // editor's text/code preview keeps working past reload.
                  //
                  // Match with `contentReferencesAttachment`, NOT `md.includes(a.url)`:
                  // the editor persists the durable `markdownLink`
                  // (`/api/attachments/<id>/download` / `markdown_url`) into the
                  // body, never the raw storage `a.url`. A bare `md.includes(a.url)`
                  // therefore never matches, so the upload is never linked via
                  // `attachment_ids`. After reload it's absent from
                  // `issueAttachments`, the renderer can't resolve it to a
                  // freshly-signed `download_url`, and the persisted auth-gated
                  // download endpoint fails to load as a native <img> on clients
                  // whose origin isn't the API host (Desktop/Electron, mobile
                  // webview) — while still working on web via the cookie/proxy.
                  // This mirrors the comment/reply/chat composers, which already
                  // bind via `contentReferencesAttachment` (MUL-3130 / MUL-3192).
                  const ids = descPendingAttachmentsRef.current
                    .filter((a) => contentReferencesAttachment(md, a))
                    .map((a) => a.id);
                  queueDescriptionSave({
                    markdown: md,
                    baseMarkdown,
                    attachmentIds: ids,
                  });
                }}
                onUploadFile={handleDescriptionUpload}
                debounceMs={1500}
                // Closing the issue modal must save what the user last saw —
                // without the flush, a paste followed by a quick close loses
                // the image markdown and its attachment_ids bind (MUL-3254).
                flushPendingOnUnmount
                currentIssueId={id}
                attachments={descEditorAttachments}
              />
            </div>

            <div className="flex items-center gap-1 mt-3">
              <ReactionBar
                reactions={issueReactions}
                currentUserId={user?.id}
                onToggle={handleToggleIssueReaction}
                getActorName={getActorName}
              />
              <FileUploadButton
                size="sm"
                multiple
                onSelect={(file) => descEditorRef.current?.uploadFile(file)}
              />
            </div>
            {descDragOver && <FileDropOverlay />}
          </div>

          {/* Sub-issues — Linear-style */}
          {childIssues.length === 0 && (
            <div className="mt-6">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => actions.openCreateSubIssue()}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t(($) => $.detail.add_sub_issues)}</span>
              </button>
            </div>
          )}
          {childIssues.length > 0 && (() => {
            const doneCount = childIssues.filter((c) => issueBehavesAs(c, "done")).length;
            return (
              // Provider hosts the shared right-click actions menu the rows
              // delegate to (one singleton menu, not one per row).
              <IssueContextMenuProvider>
              <div className="mt-10 group/sub-issues">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSubIssuesCollapsed((v) => !v)}
                    className="flex items-center gap-1.5 text-body font-medium text-foreground hover:text-foreground/80 transition-colors"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        subIssuesCollapsed && "-rotate-90",
                      )}
                    />
                    <span>{t(($) => $.detail.sub_issues_label)}</span>
                  </button>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5">
                    <ProgressRing done={doneCount} total={childIssues.length} size={11} />
                    <span className="text-micro text-muted-foreground tabular-nums font-medium">
                      {doneCount}/{childIssues.length}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allChildrenSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someChildrenSelected && !allChildrenSelected;
                    }}
                    onChange={handleToggleSelectAllChildren}
                    aria-label={t(($) => $.detail.select_all_sub_issues_aria)}
                    className={cn(
                      "ml-1 cursor-pointer accent-primary transition-opacity",
                      someChildrenSelected
                        ? "opacity-100"
                        : "opacity-0 group-hover/sub-issues:opacity-100 focus-visible:opacity-100",
                    )}
                  />
                  <div className="ml-auto flex items-center gap-0.5">
                    <SubIssueDisplayPopover workspaceProperties={activeWorkspaceProperties} />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            onClick={() => actions.openCreateSubIssue()}
                            aria-label={t(($) => $.detail.add_sub_issue_aria)}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        }
                      />
                      <TooltipContent side="bottom">{t(($) => $.detail.add_sub_issue_tooltip)}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Inline batch toolbar — appears next to the rows when
                    selections exist, instead of as a far-away fixed bar. */}
                <BatchActionToolbar issues={childIssues} placement="inline" />

                {/* List */}
                {!subIssuesCollapsed && (() => {
                  const groups = groupSubIssuesByStage(childIssues);
                  const staged = childIssues.some((c) => c.stage != null);
                  return (
                    <div className="overflow-hidden rounded-lg border bg-card/30 divide-y divide-border/60">
                      {groups.map(({ stage: groupStage, items }) => (
                        <Fragment key={groupStage ?? "unstaged"}>
                          {staged && (
                            <div className="bg-muted/40 px-3 py-1 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                              {groupStage == null
                                ? t(($) => $.stage.none)
                                : t(($) => $.stage.value, { n: groupStage })}
                            </div>
                          )}
                          {items.map((child) => (
                            <SubIssueRow
                              key={child.id}
                              child={child}
                              childProgress={subIssueProgress?.get(child.id)}
                              rowProps={subIssueRowProps}
                              customProperties={subIssueCustomProps}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  );
                })()}
              </div>
              </IssueContextMenuProvider>
            );
          })()}

          <div className="my-8 border-t" />

          <section className="space-y-3" aria-labelledby={`conclusion-label-${id}`}>
            <h2 id={`conclusion-label-${id}`} className="text-title-sm font-semibold">
              <label htmlFor={`conclusion-${id}`}>{t(($) => $.detail.conclusion)}</label>
            </h2>
            <Textarea
              id={`conclusion-${id}`}
              value={conclusionDraft?.issueId === id ? conclusionDraft.value : issue.conclusion ?? ""}
              onChange={(event) => {
                setConclusionDraft({ issueId: id, value: event.target.value });
                setConclusionError(null);
              }}
              disabled={!user || conclusionMutation.isPending}
              className="min-h-32 resize-y"
            />
            {conclusionError === id && <p role="alert" className="text-body text-destructive">{t(($) => $.detail.conclusion_save_failed)}</p>}
            <Button
              type="button"
              size="sm"
              disabled={!user || conclusionMutation.isPending || conclusionDraft?.issueId !== id || conclusionDraft.value === (issue.conclusion ?? "")}
              aria-busy={conclusionMutation.isPending}
              onClick={() => {
                if (conclusionDraft?.issueId !== id) return;
                setConclusionError(null);
                conclusionMutation.mutate({ id, conclusion: conclusionDraft.value }, {
                  onSuccess: () => setConclusionDraft((draft) => draft?.issueId === id ? null : draft),
                  onError: () => setConclusionError(id),
                });
              }}
            >
              {t(($) => $.detail.save_conclusion)}
            </Button>
          </section>
        </div>
        </div>


      </div>
    </CurrentIssueRenderContextProvider>
  );

  // Hosts the one viewer this issue's files page through — see
  // PreviewSequenceProvider. Wraps the column and the sidebar, so the
  // description's files, the timeline's and the sidebar's deliverables all
  // open into one sequence. The versions provider lets each comment's file
  // cards mark a re-uploaded file `v2`.
  const withPreview = (layout: ReactNode) => (
    <PreviewSequenceProvider
      items={previewSequence}
      describeItem={describeDeliverable}
      onOpenOverview={openOverviewFromViewer}
    >
      <AttachmentVersionsProvider files={deliverableFiles}>{layout}</AttachmentVersionsProvider>
      <DeliverablesOverview
        open={overview.open}
        onClose={closeOverview}
        returnKey={overview.returnKey}
        identifier={issue.identifier}
        files={deliverableFiles}
        commentById={commentById}
      />
    </PreviewSequenceProvider>
  );

  // The peek has no room for the properties sidebar: its core properties are
  // the pills under the title, and the rest is one click away on the page.
  if (isPeek) {
    return withPreview(<div className="flex flex-1 min-h-0">{detailContent}</div>);
  }

  if (isMobile) {
    return withPreview(
      <div className="flex flex-1 min-h-0">
        {detailContent}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="right" showCloseButton={false} className="w-[320px] overflow-y-auto p-4">
            {sidebarContent}
          </SheetContent>
        </Sheet>
      </div>,
    );
  }

  return withPreview(
    <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="content" minSize="50%">
        {detailContent}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="sidebar"
        {...rightSidebarPanelMotionProps}
        data-right-sidebar-motion={desktopSidebarMotionEnabled ? "enabled" : undefined}
        defaultSize={desktopSidebarOpen ? 320 : 0}
        minSize={260}
        maxSize={420}
        collapsible
        groupResizeBehavior="preserve-pixel-size"
        panelRef={sidebarRef}
        onResize={handleDesktopSidebarResize}
      >
        <AnimatedRightSidebar open={desktopSidebarVisualOpen} motionEnabled={desktopSidebarMotionEnabled}>
          {sidebarContent}
        </AnimatedRightSidebar>
      </ResizablePanel>
    </ResizablePanelGroup>,
  );
}
