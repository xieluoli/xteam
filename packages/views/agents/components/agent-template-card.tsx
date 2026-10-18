"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import type { Agent } from "@multica/core/types";
import { isMikaAgent } from "@multica/core/onboarding";
import { useWorkspacePaths } from "@multica/core/paths";
import { agentMcpServersOptions } from "@multica/core/workspace/queries";
import { resolvePublicFileUrl } from "@multica/core/workspace/avatar-url";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { PmInstallDialog, type PmInstallRelease } from "./pm-install-dialog";
import { listManagedMcpServers } from "./tabs/mcp-config-model";

export function AgentTemplateCard({
  agent,
  author,
  pmInstallRelease,
}: {
  agent: Agent;
  author: string;
  pmInstallRelease?: PmInstallRelease;
}) {
  const { t } = useT("agents");
  const paths = useWorkspacePaths();
  const assigned = useQuery(agentMcpServersOptions(agent.id));
  const mcpNames = [...new Set([
    ...listManagedMcpServers(agent.mcp_config).map((server) => server.name),
    ...(assigned.data ?? []).map((server) => server.name),
  ])].sort((left, right) => left.localeCompare(right));

  const canInstallPm = pmInstallRelease && agent.name === "pm-demo" && !agent.system_key &&
    agent.instructions.trim() === pmInstallRelease.instructions.trim() && !agent.mcp_config &&
    !agent.mcp_config_redacted && !assigned.isPending && !assigned.isError && assigned.data?.length === 0 &&
    agent.skills.length === pmInstallRelease.skillNames.length && agent.skills.every((skill) =>
      skill.enabled && pmInstallRelease.skillNames.includes(skill.name),
    );

  return (
    <article
      aria-label={agent.name}
      className="group relative flex min-h-[25rem] w-full min-w-0 max-w-sm flex-col rounded-xl border bg-card p-6 transition-colors hover:border-primary/40 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
    >
      <div className="flex items-start justify-between gap-3">
        <ActorAvatar
          name={agent.name}
          initials=""
          isAgent
          avatarUrl={resolvePublicFileUrl(agent.avatar_url ?? "emoji:🤖")}
          size="xl"
        />
        {isMikaAgent(agent) && (
          <Badge variant="outline" className="h-auto min-h-5 max-w-[65%] whitespace-normal bg-muted text-muted-foreground">
            {t(($) => $.marketplace.built_in)}
          </Badge>
        )}
      </div>
      <h2 className="mt-5 text-title font-semibold break-words">
        <AppLink
          href={paths.agentDetail(agent.id)}
          aria-label={t(($) => $.marketplace.view_template, { name: agent.name })}
          className="outline-none after:absolute after:inset-0 after:rounded-xl"
        >
          {agent.name}
        </AppLink>
      </h2>
      {agent.description && (
        <p className="mt-2 line-clamp-3 text-body text-muted-foreground break-words" title={agent.description}>
          {agent.description}
        </p>
      )}
      <dl className="my-6 space-y-4 text-caption">
        <div>
          <dt className="mb-2 font-medium text-muted-foreground">{t(($) => $.marketplace.skills)}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {agent.skills.length ? agent.skills.map((skill) => (
              <Badge key={skill.id} variant="secondary" className="h-auto min-h-5 max-w-full whitespace-normal break-all">
                {skill.name}
              </Badge>
            )) : <span className="text-muted-foreground">{t(($) => $.marketplace.no_skills)}</span>}
          </dd>
        </div>
        <div>
          <dt className="mb-2 font-medium text-muted-foreground">{t(($) => $.marketplace.mcp)}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {mcpNames.map((name) => (
              <Badge key={name} variant="outline" className="h-auto min-h-5 max-w-full whitespace-normal break-all">{name}</Badge>
            ))}
            {assigned.isPending ? (
              <span className="text-muted-foreground">{t(($) => $.marketplace.loading)}</span>
            ) : assigned.isError ? (
              <div className="relative z-10 flex flex-wrap items-center gap-2 text-destructive">
                <span>{t(($) => $.marketplace.mcp_error)}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => void assigned.refetch()}>
                  {t(($) => $.page.try_again)}
                </Button>
              </div>
            ) : !mcpNames.length && !agent.mcp_config_redacted ? (
              <span className="text-muted-foreground">{t(($) => $.marketplace.no_mcp)}</span>
            ) : null}
            {agent.mcp_config_redacted && (
              <span className="w-full text-muted-foreground">{t(($) => $.marketplace.mcp_private)}</span>
            )}
          </dd>
        </div>
      </dl>
      <footer className="relative z-10 mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
        <div className="min-w-0 flex-1 text-caption">
          <p className="text-muted-foreground">{t(($) => $.marketplace.author)}</p>
          <p className="mt-1 truncate font-medium" title={author}>{author}</p>
        </div>
        {canInstallPm ? <PmInstallDialog release={pmInstallRelease} /> : (
          <Button type="button" variant="outline" size="icon-sm" disabled aria-label={t(($) => $.marketplace.copy)}>
            <Copy aria-hidden="true" />
          </Button>
        )}
      </footer>
    </article>
  );
}
