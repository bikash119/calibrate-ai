import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  JobScoresResponseSchema,
  ScoringJobStatusResponseSchema,
  ScoringJobsResponseSchema,
  type JobScoresResponse,
  type ScoringJobItem,
  type ScoringJobStatusResponse,
  type ScoringJobsResponse,
  type SplitName,
} from "../schemas";

const POLL_MS = 1000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function useScoringJobs(projectId: number | undefined) {
  return useQuery<ScoringJobsResponse>({
    queryKey: ["scoringJobs", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}/scoring-jobs`, ScoringJobsResponseSchema),
    enabled: projectId !== undefined,
    // Refetch the list while there's an active job, so progress shows even if
    // the user hasn't opened a specific job's polling hook.
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs ?? [];
      return jobs.some((j: ScoringJobItem) => !TERMINAL.has(j.status)) ? POLL_MS : false;
    },
  });
}

/** Polls a single job's status until it reaches a terminal state. */
export function useScoringJobStatus(jobId: number | undefined) {
  return useQuery<ScoringJobStatusResponse>({
    queryKey: ["scoringJob", jobId],
    queryFn: () =>
      apiFetch(`/scoring-jobs/${jobId}`, ScoringJobStatusResponseSchema),
    enabled: jobId !== undefined,
    refetchInterval: (q) =>
      q.state.data && TERMINAL.has(q.state.data.status) ? false : POLL_MS,
  });
}

export function useJobScores(jobId: number | undefined) {
  return useQuery<JobScoresResponse>({
    queryKey: ["jobScores", jobId],
    queryFn: () => apiFetch(`/scoring-jobs/${jobId}/scores`, JobScoresResponseSchema),
    enabled: jobId !== undefined,
  });
}

interface SubmitJobBody {
  iteration_id: number;
  split: SplitName;
  provider?: string | null;
  model?: string | null;
}

export function useSubmitScoringJob(projectId: number) {
  const qc = useQueryClient();
  return useMutation<ScoringJobStatusResponse, Error, SubmitJobBody>({
    mutationFn: ({ iteration_id, split, provider, model }) =>
      apiFetch(
        `/projects/${projectId}/iterations/${iteration_id}/score`,
        ScoringJobStatusResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({ split, provider, model }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scoringJobs", projectId] });
    },
  });
}

export function useCancelScoringJob() {
  const qc = useQueryClient();
  return useMutation<ScoringJobStatusResponse, Error, number>({
    mutationFn: (jobId) =>
      apiFetch(`/scoring-jobs/${jobId}/cancel`, ScoringJobStatusResponseSchema, {
        method: "POST",
      }),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ["scoringJob", jobId] });
      qc.invalidateQueries({ queryKey: ["scoringJobs"] });
    },
  });
}
