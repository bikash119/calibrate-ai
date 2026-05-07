/**
 * Per-criterion agreement metrics table.
 *
 * Generic over the metric set: pass in the list of `AgreementMetricItem` rows
 * and we'll group by criterion and render one row per criterion. Used by both
 * the H-H baseline (no comparison) and the LLM-H iteration view (compares
 * against H-H baseline via the optional `baselineByCriterion` prop).
 */

import { TrafficLight, trafficStatusFor } from "../../components/ui/TrafficLight";
import type { AgreementMetricItem } from "../../schemas";

interface Props {
  /** All per-criterion metric rows (qwk, exact, within_1, krippendorff…). */
  rows: AgreementMetricItem[];
  /** Optional H-H baseline for traffic-light coloring (LLM-H view only). */
  baselineByCriterion?: Map<number, { qwk: number; ci_low: number }>;
}

interface CriterionGroup {
  criterion_id: number;
  criterion_name: string;
  qwk?: AgreementMetricItem;
  exact?: AgreementMetricItem;
  within_1?: AgreementMetricItem;
  krippendorff?: AgreementMetricItem;
}

export function MetricsTable({ rows, baselineByCriterion }: Props) {
  const groups = groupByCriterion(rows);

  if (groups.length === 0) {
    return (
      <div className="text-sm text-[var(--fg-muted)]">No metrics yet.</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="metrics-table w-full text-sm [font-variant-numeric:tabular-nums]">
        <thead>
          <tr className="text-left text-xs text-[var(--fg-muted)]">
            <th className="font-medium pb-2 pr-3">Criterion</th>
            <th className="font-medium pb-2 pr-3">QWK</th>
            <th className="font-medium pb-2 pr-3">95% CI</th>
            <th className="font-medium pb-2 pr-3">Exact</th>
            <th className="font-medium pb-2 pr-3">Within 1</th>
            {!baselineByCriterion && (
              <th className="font-medium pb-2 pr-3">α</th>
            )}
            <th className="font-medium pb-2 pr-3 text-right">n</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const qwk = g.qwk?.value;
            const baseline = baselineByCriterion?.get(g.criterion_id);
            const status =
              qwk != null && baseline
                ? trafficStatusFor(qwk, { qwkLow: baseline.ci_low })
                : null;
            return (
              <tr key={g.criterion_id} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {status && <TrafficLight status={status} />}
                    <span>{g.criterion_name}</span>
                  </div>
                </td>
                <td className="py-2 pr-3">{fmt(qwk, 3)}</td>
                <td className="py-2 pr-3 text-[var(--fg-muted)]">
                  {g.qwk?.ci_low != null && g.qwk?.ci_high != null
                    ? `[${g.qwk.ci_low.toFixed(2)}, ${g.qwk.ci_high.toFixed(2)}]`
                    : "—"}
                </td>
                <td className="py-2 pr-3">{fmt(g.exact?.value, 2)}</td>
                <td className="py-2 pr-3">{fmt(g.within_1?.value, 2)}</td>
                {!baselineByCriterion && (
                  <td className="py-2 pr-3">{fmt(g.krippendorff?.value, 3)}</td>
                )}
                <td className="py-2 pr-3 text-right text-[var(--fg-muted)]">
                  {g.qwk?.n ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function groupByCriterion(rows: AgreementMetricItem[]): CriterionGroup[] {
  const map = new Map<number, CriterionGroup>();
  for (const r of rows) {
    if (r.criterion_id == null) continue;
    let g = map.get(r.criterion_id);
    if (!g) {
      g = {
        criterion_id: r.criterion_id,
        criterion_name: r.criterion_name ?? `criterion ${r.criterion_id}`,
      };
      map.set(r.criterion_id, g);
    }
    if (r.metric === "qwk") g.qwk = r;
    else if (r.metric === "exact") g.exact = r;
    else if (r.metric === "within_1") g.within_1 = r;
    else if (r.metric === "krippendorff") g.krippendorff = r;
  }
  return Array.from(map.values()).sort((a, b) =>
    a.criterion_name.localeCompare(b.criterion_name),
  );
}

function fmt(v: number | null | undefined, digits: number): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}
