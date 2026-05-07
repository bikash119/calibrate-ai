import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import { BaselineResponseSchema, type BaselineResponse } from "../schemas";

export function useBaseline(projectId: number | undefined) {
  return useQuery<BaselineResponse>({
    queryKey: ["baseline", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/baseline`, BaselineResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useComputeBaseline(projectId: number) {
  const qc = useQueryClient();
  return useMutation<BaselineResponse, Error, void>({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/baseline/compute`, BaselineResponseSchema, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["baseline", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
