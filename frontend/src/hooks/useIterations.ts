import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  DiffResponseSchema,
  IterationDetailResponseSchema,
  IterationsListResponseSchema,
  type CriterionPromptInput,
  type DiffResponse,
  type IterationDetailResponse,
  type IterationsListResponse,
} from "../schemas";

export function useIterations(projectId: number | undefined) {
  return useQuery<IterationsListResponse>({
    queryKey: ["iterations", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/iterations`, IterationsListResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useIteration(projectId: number | undefined, iterationId: number | undefined) {
  return useQuery<IterationDetailResponse>({
    queryKey: ["iteration", projectId, iterationId],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/iterations/${iterationId}`,
        IterationDetailResponseSchema,
      ),
    enabled: projectId !== undefined && iterationId !== undefined,
  });
}

interface CreateIterationBody {
  prompts: CriterionPromptInput[];   // empty array → auto-generate from rubric
  note?: string | null;
}

export function useCreateIteration(projectId: number) {
  const qc = useQueryClient();
  return useMutation<IterationDetailResponse, Error, CreateIterationBody>({
    mutationFn: (body) =>
      apiFetch(`/projects/${projectId}/iterations`, IterationDetailResponseSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iterations", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDiff(
  projectId: number | undefined,
  fromVersion: number | undefined,
  toVersion: number | undefined,
) {
  return useQuery<DiffResponse>({
    queryKey: ["diff", projectId, fromVersion, toVersion],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/iterations/${fromVersion}/diff/${toVersion}`,
        DiffResponseSchema,
      ),
    enabled:
      projectId !== undefined &&
      fromVersion !== undefined &&
      toVersion !== undefined &&
      fromVersion !== toVersion,
  });
}
