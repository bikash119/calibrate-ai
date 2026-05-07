import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  RubricResponseSchema,
  type RubricResponse,
  type RubricSaveRequest,
} from "../schemas";

export function useRubric(projectId: number | undefined) {
  return useQuery<RubricResponse>({
    queryKey: ["rubric", projectId],
    queryFn: () => apiFetch(`/projects/${projectId}/rubric`, RubricResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useSaveRubric(projectId: number) {
  const qc = useQueryClient();
  return useMutation<RubricResponse, Error, RubricSaveRequest>({
    mutationFn: (body) =>
      apiFetch(`/projects/${projectId}/rubric`, RubricResponseSchema, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rubric", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}
