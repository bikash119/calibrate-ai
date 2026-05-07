/**
 * Single-use test-split scoring with strong warnings.
 *
 * Once a test job completes, the test split is "consumed" and cannot be
 * rescored — that's the test-set protection guarantee. The backend enforces
 * this; the UI has to communicate the consequence loudly.
 */

import { useMemo, useState } from "react";
import { Lock, Play, X as Cancel } from "lucide-react";

import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import {
  useCancelScoringJob,
  useScoringJobs,
  useSubmitScoringJob,
} from "../../hooks/useScoring";
import type { ScoringJobItem } from "../../schemas";

interface Props {
  projectId: number;
  iterationId: number;
  iterationVersion: number;
  testConsumed: boolean;
  /** Project state — submitting test is only valid in `iterating`. */
  state: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function TestRunCard({
  projectId,
  iterationId,
  iterationVersion,
  testConsumed,
  state,
}: Props) {
  const jobsQuery = useScoringJobs(projectId);
  const submit = useSubmitScoringJob(projectId);
  const cancel = useCancelScoringJob();
  const [confirming, setConfirming] = useState(false);

  const latestTestJob = useMemo(
    () => pickLatestTest(jobsQuery.data?.jobs ?? []),
    [jobsQuery.data],
  );
  const active = latestTestJob && !TERMINAL.has(latestTestJob.status);
  const completed = latestTestJob?.status === "completed";

  const submitTest = async () => {
    setConfirming(false);
    submit.mutate({ iteration_id: iterationId, split: "test" });
  };

  const cantStart =
    state !== "iterating" || testConsumed || !!active || submit.isPending;

  return (
    <Card
      title="Final test run"
      desc={`Score v${iterationVersion} on the test split. This is the moment of truth — and the test set is single-use.`}
    >
      {!completed && (
        <Banner kind="warn" title="Single-use test set">
          Once a test job completes, the test split is consumed. You cannot
          rescore it on a different iteration without cloning the project.
          Make sure v{iterationVersion} is the version you want to evaluate.
        </Banner>
      )}

      {testConsumed && !active && (
        <Banner kind="info" title="Test split has been scored">
          A completed test job exists. Lock or abandon to finish; clone the
          project if you need a fresh split.
        </Banner>
      )}

      <div className="mt-3">
        {!latestTestJob ? (
          <div className="text-sm text-[var(--fg-muted)]">No test job yet.</div>
        ) : (
          <JobStatusRow job={latestTestJob} />
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {active ? (
          <button
            className="btn btn-sm"
            onClick={() => latestTestJob && cancel.mutate(latestTestJob.id)}
            disabled={cancel.isPending}
          >
            <Cancel className="w-3.5 h-3.5" /> Cancel
          </button>
        ) : confirming ? (
          <>
            <button className="btn btn-sm" onClick={() => setConfirming(false)}>
              Not yet
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={submitTest}
              disabled={submit.isPending}
            >
              <Lock className="w-3.5 h-3.5" />
              Yes, run test
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => setConfirming(true)}
            disabled={cantStart}
            title={
              testConsumed
                ? "Test split already consumed"
                : state !== "iterating"
                ? "Test scoring requires the iterating state"
                : ""
            }
          >
            <Play className="w-3.5 h-3.5" />
            Run test on v{iterationVersion}
          </button>
        )}
      </div>

      {submit.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {submit.error.message}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ //

function JobStatusRow({ job }: { job: ScoringJobItem }) {
  const pct =
    job.progress_total > 0
      ? Math.round((job.progress_current / job.progress_total) * 100)
      : 0;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs [font-variant-numeric:tabular-nums]">
        <span className="flex items-center gap-2">
          <span className={`pill ${statusClass(job.status)}`}>{job.status}</span>
          <span className="text-[var(--fg-muted)]">
            v{job.iteration_version} · {job.provider}/{job.model}
          </span>
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
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "completed") return "pill-green";
  if (status === "running" || status === "pending") return "pill-yellow";
  if (status === "failed") return "pill-red";
  return "";
}

function pickLatestTest(jobs: ScoringJobItem[]): ScoringJobItem | null {
  const matching = jobs.filter((j) => j.split === "test");
  if (matching.length === 0) return null;
  return matching.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  )[0];
}
