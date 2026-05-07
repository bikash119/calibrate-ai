import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  LockedPromptDetailResponseSchema,
  LockedPromptsListResponseSchema,
  type LockedPromptDetailResponse,
  type LockedPromptsListResponse,
} from "../schemas";

export function useLockedPrompts() {
  return useQuery<LockedPromptsListResponse>({
    queryKey: ["lockedPrompts"],
    queryFn: () =>
      apiFetch("/locked-prompts", LockedPromptsListResponseSchema),
  });
}

export function useLockedPrompt(id: number | undefined) {
  return useQuery<LockedPromptDetailResponse>({
    queryKey: ["lockedPrompt", id],
    queryFn: () =>
      apiFetch(`/locked-prompts/${id}`, LockedPromptDetailResponseSchema),
    enabled: id !== undefined,
  });
}

export function useLockProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation<LockedPromptDetailResponse, Error, string>({
    // Argument: name for the locked prompt.
    mutationFn: (name) =>
      apiFetch(`/projects/${projectId}/lock`, LockedPromptDetailResponseSchema, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lockedPrompts"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
