/**
 * LLM-H metrics for one iteration on one split, with H-H baseline overlay.
 *
 * Each per-criterion row gets a traffic-light indicator: green if LLM-H QWK is
 * within the H-H 95% CI, yellow within 0.10 below, red beyond. The overall QWK
 * is shown as a hero stat next to the H-H ceiling for context.
 */

import { RefreshCw } from "lucide-react";

import { Card } from "../../components/ui/Card";
import { MetricsTable } from "../metrics/MetricsTable";
import { useBaseline } from "../../hooks/useBaseline";
import {
  useComputeIterationMetrics,
  useIterationMetrics,
} from "../../hooks/useIterationMetrics";
import type { AgreementMetricItem } from "../../schemas";

interface Props {
  projectId: number;
  iterationId: number;
  iterationVersion: number;
  split: string;
}

export function IterationMetricsCard({
  projectId,
  iterationId,
  iterationVersion,
  split,
}: Props) {
  const metrics = useIterationMetrics(projectId, iterationId, split);
  const baseline = useBaseline(projectId);
  const compute = useComputeIterationMetrics(projectId, iterationId);

  const overallLlm = pickOverall(metrics.data?.overall ?? []);
  const overallHh = pickOverall(baseline.data?.overall ?? []);
  const baselineByCriterion = buildBaselineMap(baseline.data?.per_criterion ?? []);
  const hasMetrics = (metrics.data?.per_criterion.length ?? 0) > 0;

  return (
    <Card
      title={`v${iterationVersion} — ${split} metrics`}
      desc="LLM-H agreement against the human median for each (application, criterion)."
      action={
        <button
          className="btn btn-sm"
          onClick={() => compute.mutate(split)}
          disabled={compute.isPending}
        >
          <RefreshCw className="w-3 h-3" />
          {compute.isPending ? "Computing…" : hasMetrics ? "Recompute" : "Compute"}
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Hero
          label={`LLM-H QWK (${split})`}
          value={overallLlm?.value}
          accent
        />
        <Hero
          label="H-H baseline ceiling"
          value={overallHh?.value}
          ci={
            overallHh?.ci_low != null && overallHh?.ci_high != null
              ? [overallHh.ci_low, overallHh.ci_high]
              : null
          }
        />
      </div>

      {!hasMetrics ? (
        <div className="text-sm text-[var(--fg-muted)]">
          No metrics yet. Run scoring on this split, then click <em>Compute</em>.
        </div>
      ) : (
        <MetricsTable
          rows={metrics.data?.per_criterion ?? []}
          baselineByCriterion={baselineByCriterion}
        />
      )}

      {compute.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {compute.error.message}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ //

function Hero({
  label,
  value,
  ci,
  accent,
}: {
  label: string;
  value: number | null | undefined;
  ci?: [number, number] | null;
  accent?: boolean;
}) {
  return (
    <div className="px-4 py-3 rounded-[var(--radius-sm)] border border-[var(--border)]">
      <div className="text-xs text-[var(--fg-muted)] mb-0.5">{label}</div>
      <div
        className={`text-2xl font-semibold [font-variant-numeric:tabular-nums] ${
          accent ? "text-[var(--accent)]" : ""
        }`}
      >
        {value != null ? value.toFixed(3) : "—"}
      </div>
      {ci && (
        <div className="text-xs text-[var(--fg-faint)] [font-variant-numeric:tabular-nums]">
          CI [{ci[0].toFixed(2)}, {ci[1].toFixed(2)}]
        </div>
      )}
    </div>
  );
}

function pickOverall(rows: AgreementMetricItem[]): AgreementMetricItem | undefined {
  return rows.find((r) => r.metric === "qwk" && r.criterion_id == null);
}

function buildBaselineMap(
  rows: AgreementMetricItem[],
): Map<number, { qwk: number; ci_low: number }> {
  const m = new Map<number, { qwk: number; ci_low: number }>();
  for (const r of rows) {
    if (r.metric !== "qwk" || r.criterion_id == null) continue;
    if (r.value == null || r.ci_low == null) continue;
    m.set(r.criterion_id, { qwk: r.value, ci_low: r.ci_low });
  }
  return m;
}
