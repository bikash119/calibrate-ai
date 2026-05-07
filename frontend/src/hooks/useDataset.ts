import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/client";
import {
  ApplicationDetailSchema,
  ApplicationsResponseSchema,
  HumanScoresResponseSchema,
  QuestionsResponseSchema,
  type ApplicationDetail,
  type ApplicationsResponse,
  type HumanScoresResponse,
  type QuestionsResponse,
  type QuestionInput,
} from "../schemas";

const LoadResultSchema = z.object({ loaded: z.number() });
type LoadResult = z.infer<typeof LoadResultSchema>;

// ------------------------------------------------------------------ //
// Questions                                                          //
// ------------------------------------------------------------------ //

export function useQuestions(projectId: number | undefined) {
  return useQuery<QuestionsResponse>({
    queryKey: ["questions", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/questions`, QuestionsResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useSaveQuestions(projectId: number) {
  const qc = useQueryClient();
  return useMutation<QuestionsResponse, Error, QuestionInput[]>({
    mutationFn: (questions) =>
      apiFetch(`/projects/${projectId}/questions`, QuestionsResponseSchema, {
        method: "PUT",
        body: JSON.stringify({ questions }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions", projectId] });
      qc.invalidateQueries({ queryKey: ["rubric", projectId] }); // criteria validate against question keys
    },
  });
}

// ------------------------------------------------------------------ //
// Applications                                                       //
// ------------------------------------------------------------------ //

export function useApplications(projectId: number | undefined) {
  return useQuery<ApplicationsResponse>({
    queryKey: ["applications", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/applications`, ApplicationsResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useApplication(projectId: number | undefined, applicationId: number | undefined) {
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

interface ApplicationUpload {
  external_id: string;
  answers: Record<string, string>;
  metadata?: Record<string, string> | null;
}

export function useUploadApplications(projectId: number) {
  const qc = useQueryClient();
  return useMutation<LoadResult, Error, ApplicationUpload[]>({
    mutationFn: (applications) =>
      apiFetch(`/projects/${projectId}/applications`, LoadResultSchema, {
        method: "POST",
        body: JSON.stringify({ applications }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["splits", projectId] });
    },
  });
}

// ------------------------------------------------------------------ //
// Human scores                                                       //
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
