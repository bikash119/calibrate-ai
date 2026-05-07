/**
 * Submit a scoring job for an iteration on a chosen split, watch progress, cancel.
 *
 * Surfaces the latest job for the (iteration, split) pair. While pending/running,
 * polling is driven by `useScoringJobs` which refreshes the project-wide list.
 */

import { useMemo } from "react";
import { Play, X as Cancel } from "lucide-react";

import { Card } from "../../components/ui/Card";
import {
  useCancelScoringJob,
  useScoringJobs,
  useSubmitScoringJob,
} from "../../hooks/useScoring";
import type { ScoringJobItem, SplitName } from "../../schemas";

interface Props {
  projectId: number;
  iterationId: number;
  iterationVersion: number;
  split: SplitName;
  /** Disable submit when the project is in a state that doesn't allow scoring. */
  disabled?: boolean;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function ScoringPanel({
  projectId,
  iterationId,
  iterationVersion,
  split,
  disabled,
}: Props) {
  const jobsQuery = useScoringJobs(projectId);
  const submit = useSubmitScoringJob(projectId);
  const cancel = useCancelScoringJob();

  const latestJob = useMemo(
    () => pickLatest(jobsQuery.data?.jobs ?? [], iterationId, split),
    [jobsQuery.data, iterationId, split],
  );
  const active = latestJob && !TERMINAL.has(latestJob.status);

  const handleSubmit = () =>
    submit.mutate({ iteration_id: iterationId, split });

  return (
    <Card
      title={`Score ${split} split`}
      desc={
        split === "dev"
          ? "Run the LLM against the dev split to see how v" +
            iterationVersion +
            " performs."
          : "Validation: held-back signal, score sparingly."
      }
      action={
        active ? (
          <button
            className="btn btn-sm"
            onClick={() => latestJob && cancel.mutate(latestJob.id)}
            disabled={cancel.isPending}
          >
            <Cancel className="w-3 h-3" /> Cancel
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSubmit}
            disabled={disabled || submit.isPending}
            title={
              disabled
                ? "Project state doesn't allow scoring this split right now"
                : ""
            }
          >
            <Play className="w-3 h-3" />
            {submit.isPending
              ? "Submitting…"
              : latestJob
              ? "Re-score"
              : "Score"}
          </button>
        )
      }
    >
      {!latestJob ? (
        <div className="text-sm text-[var(--fg-muted)]">No job for v{iterationVersion} on this split yet.</div>
      ) : (
        <JobStatusRow job={latestJob} />
      )}
      {submit.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {submit.error.message}
        </div>
      )}
    </Card>
  );
}

function JobStatusRow({ job }: { job: ScoringJobItem }) {
  const pct =
    job.progress_total > 0
      ? Math.round((job.progress_current / job.progress_total) * 100)
      : 0;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs [font-variant-numeric:tabular-nums]">
        <span className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="text-[var(--fg-muted)]">{job.provider}/{job.model}</span>
        </span>
        <span className="text-[var(--fg-muted)]">
          {job.progress_current}/{job.progress_total} calls
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-sunken)] overflow-hidden">
        <div
          className="h-full bg-[var(--accent)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {job.cost_actual_usd != null && (
        <div className="text-xs text-[var(--fg-faint)] [font-variant-numeric:tabular-nums]">
          ${job.cost_actual_usd.toFixed(4)} actual
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "pill-green"
      : status === "running" || status === "pending"
      ? "pill-yellow"
      : status === "failed"
      ? "pill-red"
      : "";
  return <span className={`pill ${cls}`}>{status}</span>;
}

function pickLatest(
  jobs: ScoringJobItem[],
  iterationId: number,
  split: SplitName,
): ScoringJobItem | null {
  const matching = jobs.filter((j) => j.iteration_id === iterationId && j.split === split);
  if (matching.length === 0) return null;
  // Sort by created_at desc; created_at is ISO so string compare is fine
  return matching.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}
