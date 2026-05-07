import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle, Lock, RotateCcw } from "lucide-react";

import { Banner } from "../components/ui/Banner";
import { PageHead } from "../components/ui/PageHead";
import { IterationMetricsCard } from "../features/iterate/IterationMetricsCard";
import { LockModal } from "../features/posttest/LockModal";
import { TestRunCard } from "../features/posttest/TestRunCard";
import { useBaseline } from "../hooks/useBaseline";
import { useIterations } from "../hooks/useIterations";
import { useIterationMetrics } from "../hooks/useIterationMetrics";
import { useLockProject } from "../hooks/useLockedPrompts";
import { useProject } from "../hooks/useProjects";
import { useScoringJobs } from "../hooks/useScoring";
import { useSplits } from "../hooks/useSplits";
import { useTransitionProject } from "../hooks/useTransition";
import type { AgreementMetricItem, ScoringJobItem } from "../schemas";

export function PostTestPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;
  const navigate = useNavigate();

  const project = useProject(projectId);
  const iterations = useIterations(projectId);
  const splits = useSplits(projectId);
  const jobs = useScoringJobs(projectId);
  const transition = useTransitionProject(projectId ?? 0);
  const lock = useLockProject(projectId ?? 0);
  const baseline = useBaseline(projectId);

  // The "iteration to lock" = the latest iteration. We score test on the latest
  // iteration; locking snapshots the latest one.
  const latestIteration = useMemo(() => {
    const list = iterations.data?.iterations ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.version > b.version ? a : b));
  }, [iterations.data]);

  const testMetrics = useIterationMetrics(
    projectId,
    latestIteration?.id,
    "test",
  );

  const [showLock, setShowLock] = useState(false);

  if (!projectId) return null;

  if (project.error || !project.data) {
    return (
      <>
        <PageHead eyebrow="Project" title="Test & lock" />
        <Banner kind="danger" title="Project not found">
          {project.error?.message ?? "Project not accessible."}
        </Banner>
      </>
    );
  }

  const proj = project.data;
  const completedTestJob = (jobs.data?.jobs ?? []).find(
    (j: ScoringJobItem) => j.split === "test" && j.status === "completed",
  );
  const testConsumed = splits.data?.test_consumed ?? false;
  const overallTestQwk = pickOverallQwk(testMetrics.data?.overall ?? []);
  const overallHhQwk = pickOverallQwk(baseline.data?.overall ?? []);

  // ----- locked state: show success view ---------------------------- //
  if (proj.state === "locked") {
    return (
      <div>
        <PageHead
          eyebrow={proj.name}
          title="Locked"
          lede="The calibration is finalized. The locked prompt is the immutable artifact."
        />
        <Banner kind="success" title="Project locked">
          Find this project's locked prompt under{" "}
          <a className="underline" href="/locked-prompts">
            Locked prompts
          </a>{" "}
          in the sidebar.
        </Banner>
      </div>
    );
  }

  // ----- abandoned state -------------------------------------------- //
  if (proj.state === "abandoned" || proj.state === "archived") {
    return (
      <div>
        <PageHead eyebrow={proj.name} title="Test & lock" />
        <Banner kind="info" title={`Project is ${proj.state}`}>
          Clone the project to start a fresh calibration run.
        </Banner>
      </div>
    );
  }

  // ----- normal flow ------------------------------------------------- //

  const canMarkTestComplete =
    proj.state === "iterating" && !!completedTestJob;
  const canLock = proj.state === "test_run_complete" && !!completedTestJob;

  const markTestComplete = () => transition.mutate("test_run_complete");
  const abandon = async () => {
    if (!confirm("Abandon this project? It will be marked as abandoned and cannot be locked.")) {
      return;
    }
    await transition.mutateAsync("abandoned");
    navigate("/projects");
  };

  const performLock = async (name: string) => {
    const created = await lock.mutateAsync(name);
    setShowLock(false);
    navigate(`/locked-prompts/${created.id}`);
  };

  if (!latestIteration) {
    return (
      <>
        <PageHead eyebrow={proj.name} title="Test & lock" />
        <Banner kind="warn" title="No iterations yet">
          Head back to the Iterate phase and create at least one iteration.
        </Banner>
      </>
    );
  }

  return (
    <div>
      <PageHead
        eyebrow={proj.name}
        title="Test & lock"
        lede={`Run the held-out test split on v${latestIteration.version}, then lock the calibration. The test set is single-use — once consumed, splits cannot be regenerated.`}
      />

      <div className="grid gap-4 my-4">
        <TestRunCard
          projectId={projectId}
          iterationId={latestIteration.id}
          iterationVersion={latestIteration.version}
          testConsumed={testConsumed}
          state={proj.state}
        />

        {completedTestJob && (
          <IterationMetricsCard
            projectId={projectId}
            iterationId={latestIteration.id}
            iterationVersion={latestIteration.version}
            split="test"
          />
        )}
      </div>

      {/* Action footer */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="text-xs text-[var(--fg-muted)]">
          {proj.state === "iterating" && !completedTestJob && (
            <>Run the test job above to populate test metrics.</>
          )}
          {proj.state === "iterating" && completedTestJob && (
            <>
              Test scored. Review the metrics, then mark the test phase complete to enable locking.
            </>
          )}
          {proj.state === "test_run_complete" && (
            <>Locking will snapshot the rubric, v{latestIteration.version} prompts, active calibration examples, and test metrics.</>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            className="btn"
            onClick={abandon}
            disabled={transition.isPending}
            title="Mark this project as abandoned"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Abandon
          </button>

          {proj.state === "iterating" && (
            <button
              className="btn btn-primary"
              onClick={markTestComplete}
              disabled={!canMarkTestComplete || transition.isPending}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {transition.isPending ? "Advancing…" : "Mark test complete"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {proj.state === "test_run_complete" && (
            <button
              className="btn btn-primary"
              onClick={() => setShowLock(true)}
              disabled={!canLock || lock.isPending}
            >
              <Lock className="w-3.5 h-3.5" />
              Lock prompt…
            </button>
          )}
        </div>
      </div>

      {transition.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {transition.error.message}
        </div>
      )}

      {showLock && (
        <LockModal
          iterationVersion={latestIteration.version}
          testQwk={overallTestQwk?.value ?? null}
          hhBaselineQwk={overallHhQwk?.value ?? null}
          onClose={() => {
            setShowLock(false);
            lock.reset();
          }}
          onConfirm={performLock}
          submitting={lock.isPending}
          error={lock.error?.message ?? null}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //

function pickOverallQwk(rows: AgreementMetricItem[]): AgreementMetricItem | undefined {
  return rows.find((r) => r.metric === "qwk" && r.criterion_id == null);
}
