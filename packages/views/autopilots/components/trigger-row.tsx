"use client";

import { useState } from "react";
import { Clock, Pencil, RotateCw, Trash2, Webhook, Zap } from "lucide-react";
import {
  useDeleteAutopilotTrigger,
  useRotateAutopilotTriggerWebhookToken,
} from "@multica/core/autopilots/mutations";
import { buildAutopilotWebhookUrl } from "@multica/core/autopilots";
import { api } from "@multica/core/api";
import type { AutopilotTrigger } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import { formatInTimeZone } from "../../common/format-in-time-zone";
import { useT } from "../../i18n";
import { EditScheduleTriggerDialog } from "./edit-schedule-trigger-dialog";
import { cronFields, parseCron } from "./schedule-editor/cron-mapping";
import { useDescribeSchedule } from "./schedule-editor/describe";
import { WebhookUrlField } from "./webhook-url-field";

export function TriggerRow({ trigger, autopilotId, canWrite }: { trigger: AutopilotTrigger; autopilotId: string; canWrite: boolean }) {
  const { t, i18n } = useT("autopilots");
  const describeSchedule = useDescribeSchedule();
  const deleteTrigger = useDeleteAutopilotTrigger();
  const rotateToken = useRotateAutopilotTriggerWebhookToken();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTrigger.mutateAsync({ autopilotId, triggerId: trigger.id });
      toast.success(t(($) => $.trigger_row.toast_deleted));
      setConfirmOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.trigger_row.toast_delete_failed),
      );
    } finally {
      setDeleting(false);
    }
  };

  const isWebhook = trigger.kind === "webhook";
  const isApi = trigger.kind === "api";
  // Resolve the URL from the server's webhook_url first, then compose
  // from the API base URL (desktop) or window.origin (web). Falls back
  // to the relative path if neither is available.
  const webhookUrl = isWebhook
    ? buildAutopilotWebhookUrl({
        trigger,
        apiBaseUrl: api.getBaseUrl(),
        currentOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      })
    : null;

  const handleRotate = async () => {
    try {
      await rotateToken.mutateAsync({ autopilotId, triggerId: trigger.id });
      toast.success(t(($) => $.trigger_row.toast_rotated));
      setRotateOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.trigger_row.toast_rotate_failed),
      );
    }
  };

  const Icon = isWebhook ? Webhook : isApi ? Zap : Clock;
  const showWebhookUrlRow = isWebhook && webhookUrl;
  // null when the expression is beyond the structured model — those rows keep
  // showing the raw cron on its own.
  const scheduleConfig = trigger.cron_expression
    ? parseCron(trigger.cron_expression, trigger.timezone ?? "UTC")
    : null;
  const scheduleDescription = scheduleConfig ? describeSchedule(scheduleConfig) : null;

  // Delete control extracted so a webhook trigger can render it inline
  // with Copy / Rotate on the URL action row (where the other action
  // buttons live), while schedule / api triggers — which have no URL row
  // — keep it pinned to the row's top-right corner. Without this the
  // trash icon visually floats above the URL action buttons because the
  // outer flex uses `items-start`.
  const deleteButton = canWrite ? (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7 shrink-0"
      onClick={() => setConfirmOpen(true)}
      title={t(($) => $.trigger_row.delete_dialog.confirm)}
    >
      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
    </Button>
  ) : null;

  // Schedule rows only: cron and timezone are the fields this dialog edits, and
  // the API rejects them on any other kind. It rides alongside Delete so the
  // row that states a schedule is also the row that can change it — without it
  // an autopilot with two schedules has no editable schedule at all (MUL-7478).
  const editButton =
    canWrite && trigger.kind === "schedule" ? (
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        onClick={() => setEditOpen(true)}
        title={t(($) => $.trigger_row.edit_schedule)}
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    ) : null;

  return (
    <div className="flex items-start gap-3 rounded-md border px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-body font-medium">{t(($) => $.trigger_kind[trigger.kind])}</span>
          {trigger.label && (
            <span className="text-caption text-muted-foreground">({trigger.label})</span>
          )}
          {!trigger.enabled && (
            <span className="text-caption bg-muted px-1.5 py-0.5 rounded-xs">
              {t(($) => $.trigger_row.disabled_badge)}
            </span>
          )}
          {isApi && (
            <span className="text-caption bg-muted px-1.5 py-0.5 rounded-xs">
              {t(($) => $.trigger_row.deprecated_badge)}
            </span>
          )}
        </div>
        {trigger.cron_expression && (
          // The plain-language line leads; the raw expression drops to a
          // secondary line so the two never run together as one blob.
          <div className="mt-0.5 space-y-0.5">
            <div className="text-caption text-muted-foreground">
              {scheduleDescription ?? trigger.cron_expression}
              {trigger.timezone && ` (${trigger.timezone})`}
            </div>
            {scheduleDescription !== null && scheduleConfig !== null && (
              // Fields only: the zone already reads out in the sentence above,
              // where a person can use it — same rule as the editor's readback.
              <div className="font-mono text-micro text-muted-foreground">
                {cronFields(scheduleConfig)}
              </div>
            )}
          </div>
        )}
        {/* A disabled trigger keeps the next_run_at it had — the dispatcher
            filters on `enabled` instead of clearing it — so the row would
            otherwise carry the Disabled badge and a promise to run at 09:00
            in the same breath. The badge is the true one. */}
        {trigger.next_run_at && trigger.enabled && (
          <div className="text-caption text-muted-foreground">
            {t(($) => $.trigger_row.next_label, {
              date: formatInTimeZone(
                trigger.next_run_at,
                trigger.timezone ?? undefined,
                i18n.language,
              ),
            })}
          </div>
        )}
        {showWebhookUrlRow && (
          <div className="mt-1.5">
            <WebhookUrlField
              url={webhookUrl}
              actions={
                <>
                  {canWrite && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setRotateOpen(true)}
                      title={t(($) => $.trigger_row.rotate_url)}
                      disabled={rotateToken.isPending}
                    >
                      <RotateCw className={cn("h-3.5 w-3.5 text-muted-foreground", rotateToken.isPending && "animate-spin")} />
                    </Button>
                  )}
                  {deleteButton}
                </>
              }
            />
          </div>
        )}
      </div>
      {!showWebhookUrlRow && (
        <div className="flex shrink-0 items-center gap-0.5">
          {editButton}
          {deleteButton}
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={(v) => { if (!v && !deleting) setConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.trigger_row.delete_dialog.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.trigger_row.delete_dialog.description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t(($) => $.trigger_row.delete_dialog.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting
                ? t(($) => $.trigger_row.delete_dialog.deleting)
                : t(($) => $.trigger_row.delete_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <EditScheduleTriggerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        autopilotId={autopilotId}
        trigger={trigger}
      />
      <AlertDialog open={rotateOpen} onOpenChange={(v) => { if (!v && !rotateToken.isPending) setRotateOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.trigger_row.rotate_confirm_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.trigger_row.rotate_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotateToken.isPending}>
              {t(($) => $.trigger_row.rotate_confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRotate} disabled={rotateToken.isPending}>
              {rotateToken.isPending
                ? t(($) => $.trigger_row.rotate_in_progress)
                : t(($) => $.trigger_row.rotate_confirm_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
