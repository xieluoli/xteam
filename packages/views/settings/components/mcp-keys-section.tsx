"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { api } from "@multica/core/api";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { copyText } from "@multica/ui/lib/clipboard";
import { useAppOrigin } from "../../navigation";
import { useT } from "../../i18n";
import { SettingsSection, SettingsCard, SettingsRow } from "./settings-layout";

export function MCPKeysSection() {
  const { t } = useT("settings");
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  const appOrigin = useAppOrigin();
  const keys = useQuery({ queryKey: ["mcp-keys", userId], queryFn: () => api.listMCPKeys() });
  const workspaces = useQuery(workspaceListOptions());
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [expiry, setExpiry] = useState(90);
  const [write, setWrite] = useState(false);
  const [remove, setRemove] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api.createMCPKey({
    name, workspace_id: workspaceId, expires_in_days: expiry,
    scopes: ["issues:read", ...(write ? ["issues:write"] : []), ...(remove ? ["issues:delete"] : [])],
  }), onSuccess: (key) => { setSecret(key.token); setName(""); setError(""); void queryClient.invalidateQueries({ queryKey: ["mcp-keys", userId] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeMCPKey(id), onSuccess: () => { setRevokeId(null); setError(""); void queryClient.invalidateQueries({ queryKey: ["mcp-keys", userId] }); } });
  const endpoint = `${(api.getBaseUrl() || appOrigin || "").replace(/\/$/, "")}/mcp`;
  const configuration = `[mcp_servers.xteam]\nurl = ${JSON.stringify(endpoint)}\nbearer_token_env_var = "XTEAM_MCP_KEY"\n`;

  async function copy(value: string) {
    try { if (!await copyText(value)) setError(t(($) => $.mcp_keys.copy_failed)); }
    catch { setError(t(($) => $.mcp_keys.copy_failed)); }
  }

  return (
    <SettingsSection title={t(($) => $.mcp_keys.title)} description={t(($) => $.mcp_keys.description)}>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError("");
        try { await create.mutateAsync(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : t(($) => $.mcp_keys.failed)); }
      }}>
        <fieldset disabled={create.isPending || secret !== null}>
          <SettingsCard>
            <SettingsRow label={<label htmlFor="mcp-key-name">{t(($) => $.mcp_keys.name)}</label>} size="text">
              <Input id="mcp-key-name" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
            </SettingsRow>
            <SettingsRow label={<label htmlFor="mcp-key-workspace">{t(($) => $.mcp_keys.workspace)}</label>} size="select-wide">
              <select id="mcp-key-workspace" className="h-9 w-full rounded-md border bg-background px-3 text-body" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                <option value="">{t(($) => $.mcp_keys.select_workspace)}</option>
                {(workspaces.data ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label={<label htmlFor="mcp-key-expiry">{t(($) => $.mcp_keys.expiry)}</label>} size="select">
              <select id="mcp-key-expiry" className="h-9 w-full rounded-md border bg-background px-3 text-body" value={expiry} onChange={(event) => setExpiry(Number(event.target.value))}>
                {[7, 30, 90].map((days) => <option key={days} value={days}>{days} {t(($) => $.mcp_keys.days)}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label={t(($) => $.mcp_keys.read)}><input type="checkbox" checked disabled aria-label={t(($) => $.mcp_keys.read)} /></SettingsRow>
            <SettingsRow label={t(($) => $.mcp_keys.write)}><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} aria-label={t(($) => $.mcp_keys.write)} /></SettingsRow>
            <SettingsRow label={t(($) => $.mcp_keys.remove)} description={t(($) => $.mcp_keys.delete_warning)}><input type="checkbox" checked={remove} onChange={(event) => setRemove(event.target.checked)} aria-label={t(($) => $.mcp_keys.remove)} /></SettingsRow>
            <div className="flex justify-end p-4"><Button type="submit" disabled={!name.trim() || !workspaceId || create.isPending}>{t(($) => $.mcp_keys.create)}</Button></div>
          </SettingsCard>
        </fieldset>
      </form>
      {workspaces.isError && <p role="alert">{t(($) => $.mcp_keys.workspaces_failed)}</p>}
      {secret && (
        <SettingsCard>
          <div className="space-y-3 p-4">
            <p className="text-body">{t(($) => $.mcp_keys.secret_notice)}</p>
            <code className="block break-all rounded-md bg-muted p-3 text-caption">{secret}</code>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void copy(secret)}>{t(($) => $.mcp_keys.copy_key)}</Button>
              <Button onClick={() => { setSecret(null); create.reset(); }}>{t(($) => $.mcp_keys.stored)}</Button>
            </div>
          </div>
        </SettingsCard>
      )}
      <SettingsCard>
        <div className="space-y-3 p-4">
          <p className="text-caption text-muted-foreground">{t(($) => $.mcp_keys.config_notice)}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-caption">{configuration}</pre>
          <Button variant="outline" onClick={() => void copy(configuration)}>{t(($) => $.mcp_keys.copy_config)}</Button>
        </div>
      </SettingsCard>
      {keys.isPending ? <p className="text-caption">{t(($) => $.mcp_keys.loading)}</p> : keys.isError ? (
        <div role="alert">{t(($) => $.mcp_keys.load_failed)} <Button variant="outline" onClick={() => void keys.refetch()}>{t(($) => $.mcp_keys.retry)}</Button></div>
      ) : (keys.data ?? []).length === 0 ? <p className="text-caption text-muted-foreground">{t(($) => $.mcp_keys.empty)}</p> : (
        <SettingsCard>
          {(keys.data ?? []).map((key) => (
            <div key={key.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words text-body font-medium">{key.name}</p>
                  <p className="break-all text-caption text-muted-foreground">{[workspaces.data?.find((workspace) => workspace.id === key.workspace_id)?.name ?? key.workspace_id, `${key.token_prefix}…`, key.scopes.join(", ")].join(" · ")}</p>
                  <p className="text-caption text-muted-foreground">{t(($) => $.mcp_keys.expires)} {key.expires_at} · {t(($) => $.mcp_keys.last_used)} {key.last_used_at ?? t(($) => $.mcp_keys.never)}</p>
                </div>
                <Button variant="outline" disabled={revoke.isPending} aria-label={t(($) => $.mcp_keys.revoke_name, { name: key.name })} onClick={() => { setRevokeId(key.id); setError(""); }}>{t(($) => $.mcp_keys.revoke)}</Button>
              </div>
              {revokeId === key.id && (
                <div className="space-y-2 rounded-md bg-muted p-3">
                  <p className="text-caption">{t(($) => $.mcp_keys.revoke_warning)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="destructive" disabled={revoke.isPending} onClick={async () => { try { await revoke.mutateAsync(key.id); } catch (failure) { setError(failure instanceof Error ? failure.message : t(($) => $.mcp_keys.failed)); } }}>{t(($) => $.mcp_keys.confirm_revoke)}</Button>
                    <Button variant="outline" disabled={revoke.isPending} onClick={() => setRevokeId(null)}>{t(($) => $.mcp_keys.cancel)}</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </SettingsCard>
      )}
      {error && <p role="alert" className="break-words text-caption text-destructive">{error}</p>}
    </SettingsSection>
  );
}
