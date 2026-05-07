import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { Banner } from "../components/ui/Banner";
import { PageHead } from "../components/ui/PageHead";
import { ApplicationsCard } from "../features/setup/ApplicationsCard";
import { HumanScoresCard } from "../features/setup/HumanScoresCard";
import { QuestionsCard } from "../features/setup/QuestionsCard";
import { RubricCard } from "../features/setup/RubricCard";
import { SplitsCard } from "../features/setup/SplitsCard";
import { useProject } from "../hooks/useProjects";
import { useRubric } from "../hooks/useRubric";
import { useApplications, useHumanScores, useQuestions } from "../hooks/useDataset";
import { useSplits } from "../hooks/useSplits";
import { useTransitionProject } from "../hooks/useTransition";

export function SetupPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;
  const navigate = useNavigate();

  const project = useProject(projectId);
  const questions = useQuestions(projectId);
  const rubric = useRubric(projectId);
  const apps = useApplications(projectId);
  const scores = useHumanScores(projectId);
  const splits = useSplits(projectId);
  const transition = useTransitionProject(projectId ?? 0);

  if (!projectId) {
    return null;
  }

  if (project.isLoading) {
    return (
      <PageHead eyebrow="Loading…" title="Setup" />
    );
  }

  if (project.error || !project.data) {
    return (
      <>
        <PageHead eyebrow="Project" title="Setup" />
        <Banner kind="danger" title="Project not found">
          {project.error?.message ?? "This project does not exist or you don't have access."}
        </Banner>
      </>
    );
  }

  const proj = project.data;
  // After 'setup', the project moves to 'baseline_computed'. Cards remain
  // viewable but most inputs are locked once we leave 'setup' to discourage
  // accidental edits that would invalidate the H-H baseline.
  const isPastSetup = proj.state !== "setup";

  // "Ready to continue" — has data + rubric + at least 2 evaluators + splits
  const evaluators = new Set(scores.data?.scores.map((s) => s.evaluator_id) ?? []);
  const splitCounts = splits.data?.counts ?? {};
  const hasSplits = (splitCounts.dev ?? 0) + (splitCounts.validation ?? 0) + (splitCounts.test ?? 0) > 0;
  const readiness = {
    questions: (questions.data?.questions.length ?? 0) > 0,
    rubric: (rubric.data?.criteria.length ?? 0) > 0,
    apps: (apps.data?.applications.length ?? 0) >= 10,
    scores: (scores.data?.scores.length ?? 0) > 0 && evaluators.size >= 2,
    splits: hasSplits,
  };
  const allReady = Object.values(readiness).every(Boolean);

  const continueToBaseline = async () => {
    if (proj.state === "setup") {
      try {
        await transition.mutateAsync("baseline_computed");
      } catch {
        return;
      }
    }
    navigate(`/projects/${projectId}/baseline`);
  };

  return (
    <div>
      <PageHead
        eyebrow={proj.name}
        title="Setup"
        lede="Define the rubric, the question schema, the applications, and the human-scored ground truth. When everything is in place, generate splits and continue."
      />

      {isPastSetup && (
        <Banner kind="info" title="Setup is read-only past this phase">
          The project is in <code>{proj.state}</code>. You can review setup, but
          editing here would invalidate downstream metrics. Clone the project to
          start fresh.
        </Banner>
      )}

      <div className="grid gap-4 my-4">
        <QuestionsCard projectId={projectId} disabled={isPastSetup} />
        <RubricCard projectId={projectId} disabled={isPastSetup} />
        <ApplicationsCard projectId={projectId} disabled={isPastSetup} />
        <HumanScoresCard projectId={projectId} disabled={isPastSetup} />
        <SplitsCard projectId={projectId} disabled={isPastSetup} />
      </div>

      {/* Continue footer */}
      {!isPastSetup && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="text-xs text-[var(--fg-muted)]">
            Ready when:
            <ReadinessChecklist readiness={readiness} />
          </div>
          <button
            className="btn btn-primary shrink-0"
            disabled={!allReady || transition.isPending}
            onClick={continueToBaseline}
          >
            {transition.isPending ? "Advancing…" : "Continue to H-H baseline"}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {transition.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {transition.error.message}
        </div>
      )}
    </div>
  );
}

function ReadinessChecklist({
  readiness,
}: {
  readiness: { questions: boolean; rubric: boolean; apps: boolean; scores: boolean; splits: boolean };
}) {
  const items = [
    { ok: readiness.questions, label: "questions defined" },
    { ok: readiness.rubric, label: "rubric defined" },
    { ok: readiness.apps, label: "≥10 applications uploaded" },
    { ok: readiness.scores, label: "≥2 evaluators with scores" },
    { ok: readiness.splits, label: "splits generated" },
  ];
  return (
    <ul className="grid gap-0.5 mt-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={
              item.ok
                ? "text-[var(--green)]"
                : "text-[var(--fg-faint)]"
            }
          >
            {item.ok ? "✓" : "○"}
          </span>
          <span className={item.ok ? "" : "text-[var(--fg-faint)]"}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
