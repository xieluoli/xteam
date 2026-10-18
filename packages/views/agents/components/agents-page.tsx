"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Bot, Plus, Search } from "lucide-react";
import { isMikaAgent } from "@multica/core/onboarding";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../../layout/collection-page";
import type { PmInstallRelease } from "./pm-install-dialog";
import { AgentTemplateCard } from "./agent-template-card";

export function AgentsPage({ pmInstallRelease }: { pmInstallRelease?: PmInstallRelease } = {}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const agents = useQuery(agentListOptions(wsId));
  const members = useQuery(memberListOptions(wsId));
  const templates = (agents.data ?? []).filter((agent) => !agent.archived_at);
  const query = search.trim().toLocaleLowerCase();
  const visible = templates.filter((agent) => {
    const content = [agent.name, agent.description, ...agent.skills.map((skill) => skill.name)].join(" ");
    return content.toLocaleLowerCase().includes(query) || matchesPinyin(content, query);
  }).sort((left, right) =>
    Number(isMikaAgent(right)) - Number(isMikaAgent(left)) || left.name.localeCompare(right.name),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Bot}
        title={t(($) => $.marketplace.title)}
        count={templates.length}
        actions={
          <CollectionPageHeaderAction
            icon={Plus}
            label={t(($) => $.page.new_agent)}
            onClick={() => navigation.push(paths.newAgent())}
          />
        }
      />
      <div className="px-6 py-4">
        <div className="relative max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t(($) => $.marketplace.search)}
            placeholder={t(($) => $.marketplace.search)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {agents.isPending ? (
          <div aria-busy="true" aria-label={t(($) => $.marketplace.loading)} className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-5">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[25rem] rounded-xl" />)}
          </div>
        ) : agents.isError ? (
          <CollectionPageState
            role="alert"
            tone="destructive"
            icon={AlertCircle}
            title={t(($) => $.page.list_load_failed)}
            description={agents.error instanceof Error ? agents.error.message : t(($) => $.page.list_load_failed_default)}
            actions={<Button type="button" variant="outline" size="sm" onClick={() => void agents.refetch()}>{t(($) => $.page.try_again)}</Button>}
          />
        ) : !templates.length ? (
          <CollectionPageState icon={Bot} title={t(($) => $.marketplace.empty)} />
        ) : !visible.length ? (
          <CollectionPageState icon={Search} title={t(($) => $.marketplace.no_matches)} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] items-stretch gap-5">
            {visible.map((agent) => (
              <AgentTemplateCard
                key={agent.id}
                agent={agent}
                pmInstallRelease={pmInstallRelease}
                author={isMikaAgent(agent) ? "Multica" : members.data?.find((member) => member.user_id === agent.owner_id)?.name || (
                  members.isPending ? t(($) => $.marketplace.loading) : t(($) => $.marketplace.unknown_author)
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
