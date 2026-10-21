import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { projectKeys } from "./queries";
import type { ProjectContext } from "./context-schema";

export * from "./context-schema";

export const projectContextKey = (wsId: string, projectId: string) =>
  [...projectKeys.detail(wsId, projectId), "context"] as const;

export const projectContextOptions = (wsId: string, projectId: string) => queryOptions({
  queryKey: projectContextKey(wsId, projectId),
  queryFn: () => api.getProjectContext(projectId),
});

export function useSaveProjectContext(wsId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (document: ProjectContext) => api.updateProjectContext(projectId, document),
    onSuccess: (document) => queryClient.setQueryData(projectContextKey(wsId, projectId), document),
  });
}
