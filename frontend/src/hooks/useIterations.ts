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
  /** Per-criterion overlay (shape A): set to inherit unchanged criteria
   *  from a prior iteration. Omit for a full new version. */
  parent_iteration_id?: number | null;
  /** Criterion ids the operator is editing this round. Required when
   *  `parent_iteration_id` is set; ignored otherwise. */
  edited_criterion_ids?: number[] | null;
  /** Save without committing to scoring. Default false. */
  as_draft?: boolean;
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

interface UpdateIterationStatusBody {
  iterationId: number;
  status: "draft" | "active" | "abandoned";
}

export function useUpdateIterationStatus(projectId: number) {
  const qc = useQueryClient();
  return useMutation<IterationDetailResponse, Error, UpdateIterationStatusBody>({
    mutationFn: ({ iterationId, status }) =>
      apiFetch(
        `/projects/${projectId}/iterations/${iterationId}/status`,
        IterationDetailResponseSchema,
        { method: "POST", body: JSON.stringify({ status }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iterations", projectId] });
      qc.invalidateQueries({ queryKey: ["iteration", projectId] });
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
