"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { copyText } from "@multica/ui/lib/clipboard";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../../i18n";

export interface PmInstallRelease {
  url: string;
  sha256: string;
  version: string;
  instructions: string;
  skillNames: string[];
}

export function PmInstallDialog({ release }: { release: PmInstallRelease }) {
  const { t } = useT("agents");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const instructions = t(($) => $.pm_install.instructions, {
    url: release.url, sha256: release.sha256, version: release.version,
    interpolation: { escapeValue: false },
  });
  async function copy() {
    setCopyState(await copyText(instructions) ? "copied" : "failed");
  }
  return (
    <Dialog onOpenChange={() => setCopyState("idle")}>
      <DialogTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={t(($) => $.marketplace.copy)} />}>
        <Copy aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(($) => $.pm_install.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.pm_install.description)}</DialogDescription>
        </DialogHeader>
        <p className="text-caption text-muted-foreground">{t(($) => $.pm_install.snapshot, { version: release.version })}</p>
        <Textarea readOnly aria-label={t(($) => $.pm_install.instructions_label)} value={instructions} className="min-h-64 font-mono text-caption" />
        <p className="text-caption text-muted-foreground">{t(($) => $.pm_install.requirements)}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href={release.url} target="_blank" rel="noopener noreferrer" className="text-label underline underline-offset-4">
            {t(($) => $.pm_install.download)}
          </a>
          <Button type="button" onClick={() => void copy()}>{t(($) => $.pm_install.copy_instructions)}</Button>
        </div>
        {copyState === "copied" && <p role="status" className="text-caption">{t(($) => $.pm_install.copied)}</p>}
        {copyState === "failed" && <p role="alert" className="text-caption text-destructive">{t(($) => $.pm_install.copy_failed)}</p>}
      </DialogContent>
    </Dialog>
  );
}
