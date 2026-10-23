"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { issueImportedUsageOptions } from "@multica/core/issues/queries";
import { useT } from "../../i18n";

export function ImportedUsageSection({ issueId }: { issueId: string }) {
  const { t } = useT("issues");
  const workspaceId = useWorkspaceId();
  const { data, isError } = useQuery(issueImportedUsageOptions(workspaceId, issueId));
  if (isError) return <p role="alert" className="px-2 text-caption text-destructive">{t(($) => $.imported_usage.load_error)}</p>;
  if (!data?.length) return null;
  return (
    <section className="space-y-3 px-2 text-caption" aria-label={t(($) => $.imported_usage.title)}>
      <h3 className="font-medium">{t(($) => $.imported_usage.title)}</h3>
      <p className="text-muted-foreground">{t(($) => $.imported_usage.separate)}</p>
      {data.map((snapshot) => (
        <div key={`${snapshot.source_workspace_id}/${snapshot.source_issue_id}`} className="space-y-1">
          <p className="break-words font-medium">{snapshot.source_name} · {snapshot.source_issue_identifier}</p>
          <p className="text-muted-foreground">{t(($) => $.imported_usage.captured)} · {new Date(snapshot.captured_at).toLocaleString()}</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 tabular-nums">
            <dt>{t(($) => $.imported_usage.input)}</dt><dd>{snapshot.input_tokens.toLocaleString()}</dd>
            <dt>{t(($) => $.imported_usage.output)}</dt><dd>{snapshot.output_tokens.toLocaleString()}</dd>
            <dt>{t(($) => $.imported_usage.cache_read)}</dt><dd>{snapshot.cache_read_tokens.toLocaleString()}</dd>
            <dt>{t(($) => $.imported_usage.cache_write)}</dt><dd>{snapshot.cache_write_tokens.toLocaleString()}</dd>
            <dt>{t(($) => $.imported_usage.metered_runs)}</dt><dd>{snapshot.task_count.toLocaleString()}</dd>
          </dl>
          <p className="text-muted-foreground">{snapshot.coverage
            ? t(($) => $.imported_usage.coverage, { metered: snapshot.coverage.metered_task_count, total: snapshot.coverage.terminal_task_count, missing: snapshot.coverage.unreported_task_count })
            : t(($) => $.imported_usage.unknown_coverage)}</p>
        </div>
      ))}
    </section>
  );
}
