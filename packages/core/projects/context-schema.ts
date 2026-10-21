import { z } from "zod";

export const contextCategories = ["requirements", "code", "design", "lessons"] as const;
export type ContextCategory = typeof contextCategories[number];

export const ContextReferenceSchema = z.object({
  name: z.string(),
  kind: z.enum(["url", "path"]),
  location: z.string(),
  version: z.string().default(""),
  notes: z.string().default(""),
});

const sectionSchema = z.object({
  not_applicable: z.boolean().default(false),
  references: z.array(ContextReferenceSchema).default([]),
});
const emptySection = () => ({ not_applicable: false, references: [] });

export const ProjectContextSchema = z.object({
  revision: z.number().int().nonnegative(),
  entrypoint: ContextReferenceSchema.nullable().default(null),
  reading_notes: z.string().default(""),
  sections: z.object({
    requirements: sectionSchema.default(emptySection),
    code: sectionSchema.default(emptySection),
    design: sectionSchema.default(emptySection),
    lessons: sectionSchema.default(emptySection),
  }).default(() => ({
    requirements: emptySection(), code: emptySection(),
    design: emptySection(), lessons: emptySection(),
  })),
});

export type ProjectContext = z.infer<typeof ProjectContextSchema>;
export type ContextReference = z.infer<typeof ContextReferenceSchema>;
