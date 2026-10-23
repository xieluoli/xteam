import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ImportedUsageSchema = z.object({
  source_workspace_id: z.string().min(1),
  source_issue_id: z.string().min(1),
  source_issue_identifier: z.string().min(1),
  source_name: z.string().min(1),
  captured_at: z.string().datetime({ offset: true }),
  input_tokens: count,
  output_tokens: count,
  cache_read_tokens: count,
  cache_write_tokens: count,
  task_count: count,
  coverage: z.object({
    terminal_task_count: count,
    metered_task_count: count,
    unreported_task_count: count,
  }).nullable().default(null),
});
export const ImportedUsageListSchema = z.array(ImportedUsageSchema);
export type ImportedUsage = z.infer<typeof ImportedUsageSchema>;
