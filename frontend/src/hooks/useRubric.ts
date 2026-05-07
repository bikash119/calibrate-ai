import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  RubricExtractResponseSchema,
  RubricResponseSchema,
  type RubricExtractResponse,
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

/** Extract structured criteria from pasted rubric text via LLM. */
export function useExtractRubricText(projectId: number) {
  return useMutation<RubricExtractResponse, Error, string>({
    mutationFn: (text) =>
      apiFetch(
        `/projects/${projectId}/rubric/extract-text`,
        RubricExtractResponseSchema,
        { method: "POST", body: JSON.stringify({ text }) },
      ),
  });
}

/** Extract structured criteria from an uploaded .txt / .md / .docx file. */
export function useExtractRubricFile(projectId: number) {
  return useMutation<RubricExtractResponse, Error, File>({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiFetch(
        `/projects/${projectId}/rubric/extract-file`,
        RubricExtractResponseSchema,
        { method: "POST", body: fd },
      );
    },
  });
}
