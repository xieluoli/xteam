import { z } from "zod";

export const MCPKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  workspace_id: z.string(),
  scopes: z.array(z.string()),
  token_prefix: z.string(),
  expires_at: z.string(),
  last_used_at: z.string().nullable().default(null),
  created_at: z.string(),
});
export const MCPKeyListSchema = z.array(MCPKeySchema);
export const CreatedMCPKeySchema = MCPKeySchema.extend({ token: z.string().min(1) });
export type MCPKey = z.infer<typeof MCPKeySchema>;
export type CreateMCPKeyRequest = {
  name: string;
  workspace_id: string;
  scopes: string[];
  expires_in_days: number;
};
