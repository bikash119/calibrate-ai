import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import { SplitCountsResponseSchema, type SplitCountsResponse } from "../schemas";

export function useSplits(projectId: number | undefined) {
  return useQuery<SplitCountsResponse>({
    queryKey: ["splits", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/splits`, SplitCountsResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useGenerateSplits(projectId: number) {
  const qc = useQueryClient();
  return useMutation<SplitCountsResponse, Error, void>({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/splits`, SplitCountsResponseSchema, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["splits", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}
