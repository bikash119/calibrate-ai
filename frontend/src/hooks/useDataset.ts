import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/client";
import {
  ApplicationDetailSchema,
  ApplicationsResponseSchema,
  HumanScoresResponseSchema,
  ImportPreviewResponseSchema,
  ImportResponseSchema,
  QuestionsResponseSchema,
  type ApplicationDetail,
  type ApplicationsResponse,
  type HumanScoresResponse,
  type ImportPreviewResponse,
  type ImportRequest,
  type ImportResponse,
  type QuestionsResponse,
} from "../schemas";

const LoadResultSchema = z.object({ loaded: z.number() });
type LoadResult = z.infer<typeof LoadResultSchema>;

// ------------------------------------------------------------------ //
// Questions (read-only — creation flows through the import wizard)   //
// ------------------------------------------------------------------ //

export function useQuestions(projectId: number | undefined) {
  return useQuery<QuestionsResponse>({
    queryKey: ["questions", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/questions`, QuestionsResponseSchema),
    enabled: projectId !== undefined,
  });
}

// ------------------------------------------------------------------ //
// Applications (read-only)                                           //
// ------------------------------------------------------------------ //

export function useApplications(projectId: number | undefined) {
  return useQuery<ApplicationsResponse>({
    queryKey: ["applications", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/applications`, ApplicationsResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useApplication(
  projectId: number | undefined,
  applicationId: number | undefined,
) {
  return useQuery<ApplicationDetail>({
    queryKey: ["application", projectId, applicationId],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/applications/${applicationId}`,
        ApplicationDetailSchema,
      ),
    enabled: projectId !== undefined && applicationId !== undefined,
  });
}

// ------------------------------------------------------------------ //
// Dataset import wizard                                              //
// ------------------------------------------------------------------ //

/** Parse a CSV/XLSX upload to drive the wizard's preview UI. Stateless;
 *  the file is not stored server-side. */
export function useImportPreview(projectId: number) {
  return useMutation<ImportPreviewResponse, Error, File>({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiFetch(
        `/projects/${projectId}/dataset/parse`,
        ImportPreviewResponseSchema,
        { method: "POST", body: fd },
      );
    },
  });
}

/** Atomically replace the project's questions + applications. */
export function useImportDataset(projectId: number) {
  const qc = useQueryClient();
  return useMutation<
    ImportResponse,
    Error,
    { file: File; mappings: ImportRequest }
  >({
    mutationFn: ({ file, mappings }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mappings", JSON.stringify(mappings));
      return apiFetch(
        `/projects/${projectId}/dataset/import`,
        ImportResponseSchema,
        { method: "POST", body: fd },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions", projectId] });
      qc.invalidateQueries({ queryKey: ["applications", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["splits", projectId] });
      qc.invalidateQueries({ queryKey: ["rubric", projectId] });
    },
  });
}

// ------------------------------------------------------------------ //
// Human scores (still has its own JSON/CSV upload card for now)      //
// ------------------------------------------------------------------ //

export function useHumanScores(projectId: number | undefined) {
  return useQuery<HumanScoresResponse>({
    queryKey: ["humanScores", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/human-scores`, HumanScoresResponseSchema),
    enabled: projectId !== undefined,
  });
}

interface HumanScoreUpload {
  external_id: string;
  criterion_name: string;
  evaluator_id: string;
  score: number;
}

export function useUploadHumanScores(projectId: number) {
  const qc = useQueryClient();
  return useMutation<LoadResult, Error, HumanScoreUpload[]>({
    mutationFn: (scores) =>
      apiFetch(`/projects/${projectId}/human-scores`, LoadResultSchema, {
        method: "POST",
        body: JSON.stringify({ scores }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["humanScores", projectId] });
      qc.invalidateQueries({ queryKey: ["applications", projectId] });
    },
  });
}
