import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  IterationMetricsResponseSchema,
  type IterationMetricsResponse,
} from "../schemas";

export function useIterationMetrics(
  projectId: number | undefined,
  iterationId: number | undefined,
  split: string,
) {
  return useQuery<IterationMetricsResponse>({
    queryKey: ["iterationMetrics", projectId, iterationId, split],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/iterations/${iterationId}/metrics?split=${split}`,
        IterationMetricsResponseSchema,
      ),
    enabled: projectId !== undefined && iterationId !== undefined,
  });
}

export function useComputeIterationMetrics(projectId: number, iterationId: number) {
  const qc = useQueryClient();
  return useMutation<IterationMetricsResponse, Error, string>({
    mutationFn: (split) =>
      apiFetch(
        `/projects/${projectId}/iterations/${iterationId}/metrics/compute?split=${split}`,
        IterationMetricsResponseSchema,
        { method: "POST" },
      ),
    onSuccess: (_data, split) => {
      qc.invalidateQueries({ queryKey: ["iterationMetrics", projectId, iterationId, split] });
      qc.invalidateQueries({ queryKey: ["iterations", projectId] });
      qc.invalidateQueries({ queryKey: ["iteration", projectId, iterationId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
