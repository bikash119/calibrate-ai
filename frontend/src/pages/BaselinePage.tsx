import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, BarChart3, RefreshCw } from "lucide-react";

import { Banner } from "../components/ui/Banner";
import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import { MetricsTable } from "../features/metrics/MetricsTable";
import { useBaseline, useComputeBaseline } from "../hooks/useBaseline";
import { useProject } from "../hooks/useProjects";
import { useTransitionProject } from "../hooks/useTransition";
import type { AgreementMetricItem } from "../schemas";

export function BaselinePage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;
  const navigate = useNavigate();

  const project = useProject(projectId);
  const baseline = useBaseline(projectId);
  const compute = useComputeBaseline(projectId ?? 0);
  const transition = useTransitionProject(projectId ?? 0);

  if (!projectId) return null;

  if (project.error || !project.data) {
    return (
      <>
        <PageHead eyebrow="Project" title="H-H baseline" />
        <Banner kind="danger" title="Project not found">
          {project.error?.message ?? "Project not accessible."}
        </Banner>
      </>
    );
  }

  const proj = project.data;
  const overall = pickOverallQwk(baseline.data?.overall ?? []);
  const hasMetrics = (baseline.data?.per_criterion.length ?? 0) > 0;
  const evaluatorCount = baseline.data?.evaluator_count ?? 0;
  const computedAt = overall?.computed_at ?? null;

  const continueToIterate = async () => {
    if (proj.state === "baseline_computed") {
      try {
        await transition.mutateAsync("iterating");
      } catch {
        return;
      }
    }
    navigate(`/projects/${projectId}/iterate`);
  };

  const isPastBaseline = proj.state !== "setup" && proj.state !== "baseline_computed";

  return (
    <div>
      <PageHead
        eyebrow={proj.name}
        title="Human-human baseline"
        lede="The agreement ceiling — how well your evaluators agree with each other. The LLM cannot reliably exceed this; treating it as the target keeps expectations honest."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => compute.mutate()}
            disabled={compute.isPending}
          >
            {compute.isPending ? (
              "Computing…"
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                {hasMetrics ? "Recompute" : "Compute baseline"}
              </>
            )}
          </button>
        }
      />

      {compute.error && (
        <Banner kind="danger" title="Compute failed">
          {compute.error.message}
        </Banner>
      )}

      {/* Hero */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-4">
        <HeroStat
          label="Overall QWK"
          value={overall?.value != null ? overall.value.toFixed(3) : "—"}
          sublabel={
            overall?.value != null
              ? "Macro-averaged across criteria"
              : "Click compute to populate"
          }
          accent
        />
        <HeroStat
          label="Evaluators"
          value={String(evaluatorCount)}
          sublabel={
            evaluatorCount < 2
              ? "Need ≥2 for pairwise agreement"
              : `${pairCount(evaluatorCount)} pairs compared`
          }
        />
        <HeroStat
          label="Last computed"
          value={computedAt ? relativeTime(computedAt) : "—"}
          sublabel={computedAt ? new Date(computedAt).toLocaleString() : "Never"}
        />
      </div>

      {/* Per-criterion */}
      <Card
        title="Per-criterion agreement"
        desc="QWK with bootstrap 95% CI, exact agreement, within-1 agreement, and Krippendorff's α."
      >
        {baseline.isLoading ? (
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        ) : !hasMetrics ? (
          <div className="text-sm text-[var(--fg-muted)] flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Run <em>Compute baseline</em> to populate metrics.
          </div>
        ) : (
          <MetricsTable rows={baseline.data?.per_criterion ?? []} />
        )}
      </Card>

      {/* Continue footer (only meaningful from baseline_computed) */}
      {!isPastBaseline && (
        <div className="mt-4 flex items-center justify-between gap-4 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="text-xs text-[var(--fg-muted)]">
            {proj.state === "setup"
              ? "Finish setup before iterating."
              : hasMetrics
              ? "Baseline computed. Continue to start iterating prompts."
              : "Compute the baseline first."}
          </div>
          <button
            className="btn btn-primary shrink-0"
            disabled={
              proj.state !== "baseline_computed" || !hasMetrics || transition.isPending
            }
            onClick={continueToIterate}
          >
            {transition.isPending ? "Advancing…" : "Continue to iterate"}
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

// ------------------------------------------------------------------ //
// Helpers                                                            //
// ------------------------------------------------------------------ //

function HeroStat({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel: string;
  accent?: boolean;
}) {
  return (
    <Card noPad className="px-5 py-4">
      <div className="text-xs text-[var(--fg-muted)] mb-1">{label}</div>
      <div
        className={`text-3xl font-semibold [font-variant-numeric:tabular-nums] ${
          accent ? "text-[var(--accent)]" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-[var(--fg-faint)] mt-1">{sublabel}</div>
    </Card>
  );
}

function pickOverallQwk(rows: AgreementMetricItem[]): AgreementMetricItem | undefined {
  return rows.find((r) => r.metric === "qwk" && r.criterion_id == null);
}

function pairCount(n: number): number {
  return (n * (n - 1)) / 2;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
