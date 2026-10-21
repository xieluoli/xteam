"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  contextCategories,
  projectResourcesOptions,
  projectContextOptions,
  useSaveProjectContext,
  type ProjectContext,
  type ContextReference,
} from "@multica/core/projects";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { SettingsTab, SettingsSection, SettingsCard, SettingsRow } from "../../settings/components/settings-layout";
import { useT } from "../../i18n";

const blankReference = (): ContextReference => ({
  name: "", kind: "url", location: "", version: "", notes: "",
});

function sourceHref(reference: ContextReference) {
  if (reference.kind !== "url") return undefined;
  try {
    const url = new URL(reference.location);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function ProjectContextPanel({ projectId, wsId, canEdit }: {
  projectId: string;
  wsId: string;
  canEdit: boolean;
}) {
  const { t } = useT("projects");
  const fieldId = useId();
  const query = useQuery(projectContextOptions(wsId, projectId));
  const resources = useQuery(projectResourcesOptions(wsId, projectId));
  const save = useSaveProjectContext(wsId, projectId);
  const [draft, setDraft] = useState<ProjectContext | null>(null);
  const [error, setError] = useState("");

  if (query.isPending) {
    return <p className="p-6 text-muted-foreground">{t(($) => $.context.loading)}</p>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="p-6" role="alert">
        {t(($) => $.context.load_failed)}
        <Button onClick={() => void query.refetch()} variant="outline">{t(($) => $.context.retry)}</Button>
      </div>
    );
  }

  const document = draft ?? query.data;
  const editing = canEdit && draft !== null;
  const repositories = (resources.data ?? []).filter((resource) => resource.resource_type === "github_repo");
  const change = (next: ProjectContext) => {
    setDraft(next);
    setError("");
  };
  const categoryNames = {
    requirements: t(($) => $.context.requirements),
    code: t(($) => $.context.code),
    design: t(($) => $.context.design),
    lessons: t(($) => $.context.lessons),
  };

  async function saveDocument() {
    if (!draft || !canEdit) return;
    try {
      await save.mutateAsync(draft);
      setDraft(null);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t(($) => $.context.save_failed));
    }
  }

  function referenceFields(reference: ContextReference, prefix: string, onChange: (ref: ContextReference) => void) {
    const id = `${fieldId}-${prefix}`;
    return (
      <>
        <SettingsRow label={<label htmlFor={`${id}-name`}>{t(($) => $.context.name)}</label>} size="text">
          <Input id={`${id}-name`} maxLength={200} value={reference.name} onChange={(event) => onChange({ ...reference, name: event.target.value })} />
        </SettingsRow>
        <SettingsRow label={<label htmlFor={`${id}-kind`}>{t(($) => $.context.kind)}</label>} size="select">
          <select id={`${id}-kind`} className="h-9 w-full rounded-md border bg-background px-3 text-body" value={reference.kind}
            onChange={(event) => onChange({ ...reference, kind: event.target.value === "path" ? "path" : "url" })}>
            <option value="url">{t(($) => $.context.url)}</option>
            <option value="path">{t(($) => $.context.path)}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={<label htmlFor={`${id}-location`}>{t(($) => $.context.location)}</label>} size="text">
          <Input id={`${id}-location`} maxLength={2048} value={reference.location} onChange={(event) => onChange({ ...reference, location: event.target.value })} />
        </SettingsRow>
        <SettingsRow label={<label htmlFor={`${id}-version`}>{t(($) => $.context.version)}</label>} size="text">
          <Input id={`${id}-version`} maxLength={200} value={reference.version} onChange={(event) => onChange({ ...reference, version: event.target.value })} />
        </SettingsRow>
        <SettingsRow label={<label htmlFor={`${id}-notes`}>{t(($) => $.context.notes)}</label>} size="text">
          <Input id={`${id}-notes`} maxLength={4000} value={reference.notes} onChange={(event) => onChange({ ...reference, notes: event.target.value })} />
        </SettingsRow>
      </>
    );
  }

  function referenceView(reference: ContextReference) {
    const href = sourceHref(reference);
    return (
      <div className="min-w-0 space-y-1 px-4 py-3.5 text-body break-words">
        {href ? (
          <a className="font-medium text-primary underline underline-offset-4" href={href} target="_blank" rel="noopener noreferrer">{reference.name}</a>
        ) : <p className="font-medium">{reference.name}</p>}
        <p className="break-all text-caption text-muted-foreground">{reference.location}</p>
        {reference.version && <p className="text-caption">{t(($) => $.context.version)}: {reference.version}</p>}
        {reference.notes && <p className="whitespace-pre-wrap text-caption text-muted-foreground">{reference.notes}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <SettingsTab title={t(($) => $.context.title)} description={t(($) => $.context.access_notice)} actions={canEdit && !editing ? (
          <Button variant="outline" onClick={() => change(structuredClone(query.data))}>{t(($) => $.context.edit)}</Button>
        ) : undefined}>
          <form onSubmit={(event) => { event.preventDefault(); void saveDocument(); }} className="space-y-8">
            <fieldset disabled={save.isPending} className="min-w-0 space-y-8">
              <SettingsSection title={t(($) => $.context.start)}>
                <SettingsCard>
                  {document.entrypoint ? (editing ? (
                    <div>
                      {referenceFields(document.entrypoint, "entry", (entrypoint) => change({ ...document, entrypoint }))}
                      <div className="flex justify-end px-4 pb-3.5"><Button variant="ghost" size="sm" onClick={() => change({ ...document, entrypoint: null })}>{t(($) => $.context.remove)}</Button></div>
                    </div>
                  ) : referenceView(document.entrypoint)) : (
                    <div className="px-4 py-3.5">{editing ? (
                      <Button variant="outline" size="sm" onClick={() => change({ ...document, entrypoint: blankReference() })}>{t(($) => $.context.add_entry)}</Button>
                    ) : <p className="text-caption text-muted-foreground">{t(($) => $.context.unconfigured)}</p>}</div>
                  )}
                  {editing ? (
                    <SettingsRow label={<label htmlFor={`${fieldId}-reading`}>{t(($) => $.context.reading_notes)}</label>} size="text" align="start">
                      <Textarea id={`${fieldId}-reading`} maxLength={8000} value={document.reading_notes} onChange={(event) => change({ ...document, reading_notes: event.target.value })} />
                    </SettingsRow>
                  ) : document.reading_notes && <p className="whitespace-pre-wrap px-4 py-3.5 text-body">{document.reading_notes}</p>}
                </SettingsCard>
              </SettingsSection>
              {contextCategories.map((category) => {
                const section = document.sections[category];
                const updateSection = (next: typeof section) => change({ ...document, sections: { ...document.sections, [category]: next } });
                function moveReference(index: number, direction: number) {
                  const references = [...section.references];
                  const current = references[index];
                  const adjacent = references[index + direction];
                  if (!current || !adjacent) return;
                  references[index] = adjacent;
                  references[index + direction] = current;
                  updateSection({ ...section, references });
                }
                return (
                  <div key={category} role="group" aria-label={categoryNames[category]}>
                    <SettingsSection title={categoryNames[category]} action={canEdit ? (
                      <Button variant="outline" size="sm" disabled={save.isPending || section.references.length >= 50 || section.not_applicable}
                        onClick={() => updateSection({ ...section, references: [...section.references, { ...blankReference(), location: "https://github.com/" }] })}>
                        {t(($) => $.context.add_github)}
                      </Button>
                    ) : undefined}>
                      <SettingsCard>
                        {editing && (
                          <SettingsRow label={t(($) => $.context.not_applicable)}>
                            <input type="checkbox" aria-label={t(($) => $.context.not_applicable)} checked={section.not_applicable} disabled={section.references.length > 0}
                              onChange={(event) => updateSection({ ...section, not_applicable: event.target.checked })} />
                          </SettingsRow>
                        )}
                        {!editing && section.not_applicable && <p className="px-4 py-3.5 text-caption text-muted-foreground">{t(($) => $.context.not_applicable)}</p>}
                        {!section.not_applicable && section.references.length === 0 && <p className="px-4 py-3.5 text-caption text-muted-foreground">{t(($) => $.context.unconfigured)}</p>}
                        {section.references.map((reference, index) => editing ? (
                          <div key={index}>
                            {referenceFields(reference, `${category}-${index}`, (next) => updateSection({
                              ...section, references: section.references.map((item, position) => position === index ? next : item),
                            }))}
                            <div className="flex flex-wrap justify-end gap-2 px-4 py-3.5">
                              <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveReference(index, -1)}>{t(($) => $.context.up)}</Button>
                              <Button variant="ghost" size="sm" disabled={index === section.references.length - 1} onClick={() => moveReference(index, 1)}>{t(($) => $.context.down)}</Button>
                              <Button variant="ghost" size="sm" onClick={() => updateSection({ ...section, references: section.references.filter((_, position) => position !== index) })}>{t(($) => $.context.remove)}</Button>
                            </div>
                          </div>
                        ) : <div key={index}>{referenceView(reference)}</div>)}
                        {editing && !section.not_applicable && (
                          <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3.5">
                            {repositories.length > 0 && (
                              <label className="min-w-0 text-caption">
                                {t(($) => $.context.existing_repo)}
                                <select className="mt-1 block h-9 w-full max-w-64 rounded-md border bg-background px-2 text-body" value="" disabled={section.references.length >= 50}
                                  onChange={(event) => {
                                    const resource = repositories.find((item) => item.id === event.target.value);
                                    const location = resource && "url" in resource.resource_ref ? resource.resource_ref.url : undefined;
                                    if (!resource || typeof location !== "string") return;
                                    const version = "ref" in resource.resource_ref && typeof resource.resource_ref.ref === "string" ? resource.resource_ref.ref : "";
                                    updateSection({ ...section, references: [...section.references, {
                                      ...blankReference(), name: resource.label || location,
                                      kind: location.startsWith("https://") || location.startsWith("http://") ? "url" : "path", location, version,
                                    }] });
                                  }}>
                                  <option value="">{t(($) => $.context.choose_repo)}</option>
                                  {repositories.map((resource) => <option key={resource.id} value={resource.id}>{resource.label || String("url" in resource.resource_ref ? resource.resource_ref.url : "")}</option>)}
                                </select>
                              </label>
                            )}
                            <Button variant="ghost" size="sm" disabled={section.references.length >= 50}
                              onClick={() => updateSection({ ...section, references: [...section.references, blankReference()] })}>
                              {t(($) => $.context.add)}
                            </Button>
                          </div>
                        )}
                      </SettingsCard>
                    </SettingsSection>
                  </div>
                );
              })}
            </fieldset>
            {error && <p role="alert" className="break-words text-caption text-destructive">{error}</p>}
            {editing && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button variant="outline" disabled={save.isPending} onClick={() => { setDraft(null); setError(""); }}>{t(($) => $.context.cancel)}</Button>
                <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>{save.isPending ? t(($) => $.context.saving) : t(($) => $.context.save)}</Button>
              </div>
            )}
          </form>
        </SettingsTab>
      </div>
    </div>
  );
}
