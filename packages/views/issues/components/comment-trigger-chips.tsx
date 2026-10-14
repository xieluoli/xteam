"use client";

import { useMemo, useState } from "react";
import { TriangleAlert, Users } from "lucide-react";
import type { CommentTriggerPreviewAgent, CommentTriggerOutcome } from "@multica/core/types";
import { useAgentPresenceDetail } from "@multica/core/agents";
import { mentionLabelsByTarget } from "@multica/core/issues/comment-trigger-outcomes";
import { useCurrentWorkspace } from "@multica/core/paths";
import { ActorAvatar as ActorAvatarBase } from "@multica/ui/components/common/actor-avatar";
import { AVATAR_SIZE_PX } from "@multica/ui/lib/avatar-size";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { AgentStatusDot } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { blockedReasonLabel, blockedShortReasonLabel } from "../blocked-trigger-copy";

// A read-only preview of who Send will start: the backend trigger preview decides
// the recipients, this only says so. One recipient renders as a single chip with
// its start condition; several collapse to an overlapping avatar stack with one
// row per agent in a click-opened popover, mirroring WorkspaceAgentWorkingChip on
// the issues header.
// The avatars render at the `xs` tier; the `+N` overflow chip and stack
// overlap reuse that tier's pixel diameter so the stack lines up exactly.
const AVATAR_SIZE = AVATAR_SIZE_PX.xs;
const MAX_STACK_HEADS = 4;

interface CommentTriggerChipsProps {
  recipients: CommentTriggerPreviewAgent[];
  // Explicit @agent / @squad mentions that will NOT trigger if posted as-is
  // (MUL-4525 §2). Each renders as a named warning chip so the user sees WHICH
  // target won't run and why, not a silent no-op after sending.
  blocked?: CommentTriggerOutcome[];
  /** Whether the draft contains the structured @all member broadcast. */
  hasAllMembersMention?: boolean;
  // The draft markdown, used only to label each blocked target with the name the
  // user typed in its mention markup. The server omits blocked target names
  // (enumeration-safety); this is the user's own text, so it discloses nothing new.
  draftContent?: string;
}

type IssuesT = ReturnType<typeof useT<"issues">>["t"];

function sourceLabel(source: string, t: IssuesT): string {
  switch (source) {
    case "issue_assignee":
      return t(($) => $.comment.trigger_source_issue_assignee);
    case "mention_agent":
      return t(($) => $.comment.trigger_source_mention_agent);
    case "mention_squad_leader":
      return t(($) => $.comment.trigger_source_mention_squad_leader);
    default:
      return t(($) => $.comment.trigger_source_unknown);
  }
}

// Presence is display metadata only — the trigger list itself is always the
// backend preview. Online-ish agents start right away; offline ones queue.
function useTriggerPresenceLine(agentId: string, t: IssuesT): string | null {
  const ws = useCurrentWorkspace();
  const detail = useAgentPresenceDetail(ws?.id, agentId);
  if (detail === "loading") return null;
  return detail.availability === "online" || detail.availability === "unstable"
    ? t(($) => $.comment.trigger_starts_now)
    : t(($) => $.comment.trigger_starts_when_online);
}

export function CommentTriggerChips({
  recipients,
  blocked = [],
  hasAllMembersMention = false,
  draftContent = "",
}: CommentTriggerChipsProps) {
  const { t } = useT("issues");
  // Blocked outcomes carry no name (enumeration-safety); recover the label the
  // user typed from their own draft so each chip can say which target it is.
  const blockedLabels = useMemo(() => mentionLabelsByTarget(draftContent), [draftContent]);

  // Loading and errors render nothing: the preview is an enhancement, and
  // any interim chrome here reads as composer noise.
  if (recipients.length === 0 && blocked.length === 0 && !hasAllMembersMention) return null;

  const allowed =
    recipients.length === 1 ? (
      <SingleRecipientChip agent={recipients[0]!} t={t} />
    ) : recipients.length > 1 ? (
      <MultiRecipientChip recipients={recipients} t={t} />
    ) : null;

  if (blocked.length === 0 && !hasAllMembersMention) return allowed;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hasAllMembersMention && (
        <span className="inline-flex h-6 min-w-0 max-w-full animate-in fade-in items-center gap-1.5 rounded-md px-1.5 text-micro font-medium text-muted-foreground">
          <Users className="size-3 shrink-0" />
          <span className="truncate">{t(($) => $.comment.all_members_notice)}</span>
        </span>
      )}
      {allowed}
      {blocked.map((outcome) => (
        <BlockedTriggerChip
          key={`${outcome.target_type}:${outcome.target_id}`}
          outcome={outcome}
          label={blockedLabels.get(`${outcome.target_type}:${outcome.target_id}`)}
          t={t}
        />
      ))}
    </div>
  );
}

// One blocked mention: named like an allowed chip ("Go"), but with an error
// indicator and a short reason ("Not found or no permission") instead of "will
// start", so a refused @mention reads as a clear, specific error rather than a
// vague count.
function BlockedTriggerChip({
  outcome,
  label,
  t,
}: {
  outcome: CommentTriggerOutcome;
  label?: string;
  t: IssuesT;
}) {
  const shortReason = blockedShortReasonLabel(outcome.reason_code, t);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex h-6 min-w-0 max-w-full animate-in fade-in items-center gap-1.5 rounded-md px-1.5 text-micro font-medium text-destructive"
            aria-label={
              label
                ? t(($) => $.comment.trigger_blocked_chip_aria, { name: label, reason: shortReason })
                : shortReason
            }
          >
            <TriangleAlert className="size-3 shrink-0" />
            {label ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className="truncate">{label}</span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">{shortReason}</span>
              </span>
            ) : (
              <span className="truncate">{shortReason}</span>
            )}
          </span>
        }
      />
      <TooltipContent side="top" className="max-w-72 text-caption">
        {blockedReasonLabel(outcome.reason_code, t)}
      </TooltipContent>
    </Tooltip>
  );
}

function SingleRecipientChip({
  agent,
  t,
}: {
  agent: CommentTriggerPreviewAgent;
  t: IssuesT;
}) {
  // The avatar carries "who"; the sentence carries only the outcome, so it
  // stays fixed-width and never truncates on long agent names.
  const line =
    useTriggerPresenceLine(agent.id, t) ?? t(($) => $.comment.trigger_will_start);
  return (
    <span className="inline-flex h-6 min-w-0 max-w-full animate-in fade-in items-center gap-1.5 rounded-md border border-transparent px-1.5 text-micro font-medium text-muted-foreground">
      <TriggerAgentAvatar agent={agent} />
      <span className="truncate">{line}</span>
    </span>
  );
}

function MultiRecipientChip({
  recipients,
  t,
}: {
  recipients: CommentTriggerPreviewAgent[];
  t: IssuesT;
}) {
  const [open, setOpen] = useState(false);
  const heads = recipients.slice(0, MAX_STACK_HEADS);
  const overflow = recipients.length - heads.length;
  // Mirror AgentAvatarStack: ~30% overlap reads as "stacked" without
  // obscuring the next avatar.
  const overlap = Math.round(AVATAR_SIZE * 0.3);
  const sentence = t(($) => $.comment.recipient_count, { count: recipients.length });

  const popoverTrigger = (
    <PopoverTrigger
      render={
        <button
          type="button"
          className="inline-flex h-6 min-w-0 max-w-full animate-in fade-in cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 text-micro font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
        />
      }
    >
      <span className="inline-flex items-center">
        {heads.map((agent, i) => (
          <span
            key={agent.id}
            style={{ marginLeft: i === 0 ? 0 : -overlap }}
            className="inline-flex rounded-full ring-2 ring-background"
          >
            <TriggerAgentAvatar agent={agent} showDot={false} />
          </span>
        ))}
        {overflow > 0 && (
          <span
            style={{
              marginLeft: -overlap,
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              fontSize: Math.max(9, Math.round(AVATAR_SIZE * 0.45)),
            }}
            className="inline-flex items-center justify-center rounded-full bg-muted font-medium tabular-nums text-muted-foreground ring-2 ring-background"
          >
            +{overflow}
          </span>
        )}
      </span>
      <span className="truncate">{sentence}</span>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {popoverTrigger}
      <PopoverContent align="start" className="w-80 p-2">
        <div className="px-1.5 pb-1 text-caption font-medium text-muted-foreground">
          {t(($) => $.comment.trigger_preview_title)}
        </div>
        <div className="flex flex-col">
          {recipients.map((agent) => (
            <div key={agent.id} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1">
              <TriggerAgentAvatar agent={agent} />
              <span className="min-w-0 flex-1 truncate text-caption">
                {agent.name}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground">
                {sourceLabel(agent.source, t)}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TriggerAgentAvatar({
  agent,
  showDot = true,
}: {
  agent: CommentTriggerPreviewAgent;
  showDot?: boolean;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <ActorAvatarBase
        name={agent.name}
        initials=""
        avatarUrl={agent.avatar_url}
        isAgent
        size="xs"
      />
      {showDot && <AgentStatusDot agentId={agent.id} size="xs" />}
    </span>
  );
}
