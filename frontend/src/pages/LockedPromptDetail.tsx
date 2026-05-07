import { useParams } from "react-router-dom";

import { Banner } from "../components/ui/Banner";
import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import { useLockedPrompt } from "../hooks/useLockedPrompts";

interface RubricCriterionSnapshot {
  id?: number;
  name?: string;
  description?: string;
  scale_min?: number;
  scale_max?: number;
  anchor_descriptions?: Record<string, string>;
  feeding_question_keys?: string[];
  weighted_question_keys?: string[];
}

interface ExampleSnapshot {
  criterion_id?: number;
  application_id?: number;
  human_score?: number;
  synthesized_reasoning?: string;
  source?: string;
}

interface TestMetricRow {
  criterion_id?: number | null;
  metric?: string;
  value?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
  n?: number | null;
}

interface TestMetricsSnapshot {
  llm_h_test?: TestMetricRow[];
  hh_baseline?: TestMetricRow[];
}

export function LockedPromptDetail() {
  const { lockedId: lockedIdStr } = useParams<{ lockedId: string }>();
  const lockedId = lockedIdStr ? Number(lockedIdStr) : undefined;
  const detail = useLockedPrompt(lockedId);

  if (detail.isLoading) {
    return <PageHead eyebrow="Loading…" title="Locked prompt" />;
  }

  if (detail.error || !detail.data) {
    return (
      <>
        <PageHead eyebrow="Locked prompts" title="Not found" />
        <Banner kind="danger" title="Locked prompt not found">
          {detail.error?.message ?? "This artifact doesn't exist."}
        </Banner>
      </>
    );
  }

  const lp = detail.data;
  const rubric = lp.rubric_snapshot as RubricCriterionSnapshot[];
  const prompts = lp.prompts_snapshot;
  const examples = (lp.examples_snapshot ?? []) as ExampleSnapshot[];
  const tm = lp.test_metrics as TestMetricsSnapshot;

  const overallTestQwk = (tm.llm_h_test ?? []).find(
    (r) => r.metric === "qwk" && r.criterion_id == null,
  );
  const overallHhQwk = (tm.hh_baseline ?? []).find(
    (r) => r.metric === "qwk" && r.criterion_id == null,
  );

  return (
    <div>
      <PageHead
        eyebrow="Locked prompt"
        title={lp.name}
        lede={`Snapshotted ${lp.locked_at ? new Date(lp.locked_at).toLocaleString() : "—"} from project ${lp.project_id ?? "(deleted)"} · iteration ${lp.iteration_id ?? "—"}`}
      />

      {/* Headline metrics */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 my-4">
        <HeadlineStat label="Test QWK" value={fmt(overallTestQwk?.value, 3)} accent />
        <HeadlineStat label="H-H ceiling" value={fmt(overallHhQwk?.value, 3)} />
        <HeadlineStat label="Provider" value={`${lp.provider}/${lp.model}`} />
        <HeadlineStat label="Hash" value={lp.prompt_hash.slice(0, 12)} mono />
      </div>

      {/* Rubric snapshot */}
      <Card title="Rubric snapshot" desc="Criteria as they were at lock time.">
        <div className="grid gap-3">
          {rubric.map((c, i) => (
            <div
              key={c.id ?? i}
              className="px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border)]"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold">{c.name}</span>
                <span className="text-xs text-[var(--fg-muted)]">
                  scale {c.scale_min}–{c.scale_max}
                </span>
              </div>
              <div className="text-xs text-[var(--fg-muted)] mb-2">{c.description}</div>
              {c.anchor_descriptions && (
                <div className="grid gap-0.5 text-xs">
                  {Object.entries(c.anchor_descriptions)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([score, text]) => (
                      <div key={score} className="flex gap-2">
                        <span className="font-mono text-[var(--fg-faint)] shrink-0">{score}</span>
                        <span>{text}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Prompts snapshot */}
      <div className="mt-4">
        <Card title="Prompts snapshot" desc="One system prompt per criterion. Use these verbatim for production scoring.">
          <div className="grid gap-3">
            {Object.entries(prompts).map(([criterionName, systemPrompt]) => (
              <div
                key={criterionName}
                className="px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border)]"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono text-[var(--fg-muted)]">{criterionName}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigator.clipboard?.writeText(systemPrompt as string)}
                    title="Copy prompt"
                  >
                    Copy
                  </button>
                </div>
                <pre className="text-xs font-[var(--font-mono)] whitespace-pre-wrap text-[var(--fg-muted)] max-h-72 overflow-y-auto">
                  {systemPrompt as string}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Calibration examples snapshot */}
      {examples.length > 0 && (
        <div className="mt-4">
          <Card
            title={`Calibration examples (${examples.length})`}
            desc="Few-shot examples that were active at lock time, embedded in the prompts above."
          >
            <div className="grid gap-2">
              {examples.map((ex, i) => (
                <div
                  key={i}
                  className="px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)]"
                >
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="pill pill-info">score {ex.human_score}</span>
                    <span className="text-[var(--fg-faint)]">{ex.source}</span>
                  </div>
                  <div className="text-xs italic text-[var(--fg-muted)]">
                    {ex.synthesized_reasoning}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Per-criterion test metrics */}
      <div className="mt-4">
        <Card title="Test metrics" desc="LLM-H agreement on the held-out test split, plus the H-H ceiling for context.">
          <TestMetricsTable rows={tm.llm_h_test ?? []} baseline={tm.hh_baseline ?? []} rubric={rubric} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //

function HeadlineStat({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <Card noPad className="px-4 py-3">
      <div className="text-xs text-[var(--fg-muted)] mb-1">{label}</div>
      <div
        className={`text-xl font-semibold [font-variant-numeric:tabular-nums] ${
          accent ? "text-[var(--accent)]" : ""
        } ${mono ? "font-[var(--font-mono)]" : ""}`}
      >
        {value}
      </div>
    </Card>
  );
}

function fmt(v: number | null | undefined, digits: number): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function TestMetricsTable({
  rows,
  baseline,
  rubric,
}: {
  rows: TestMetricRow[];
  baseline: TestMetricRow[];
  rubric: RubricCriterionSnapshot[];
}) {
  const nameByCid = new Map<number, string>();
  for (const c of rubric) {
    if (c.id != null && c.name) nameByCid.set(c.id, c.name);
  }

  // Pivot per-criterion qwk for both LLM-H and H-H
  const llmByCid = new Map<number, TestMetricRow>();
  for (const r of rows) {
    if (r.criterion_id != null && r.metric === "qwk") llmByCid.set(r.criterion_id, r);
  }
  const hhByCid = new Map<number, TestMetricRow>();
  for (const r of baseline) {
    if (r.criterion_id != null && r.metric === "qwk") hhByCid.set(r.criterion_id, r);
  }

  const cids = Array.from(new Set([...llmByCid.keys(), ...hhByCid.keys()])).sort();
  if (cids.length === 0) {
    return <div className="text-sm text-[var(--fg-muted)]">No per-criterion metrics in the snapshot.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="metrics-table w-full text-sm [font-variant-numeric:tabular-nums]">
        <thead>
          <tr className="text-left text-xs text-[var(--fg-muted)]">
            <th className="font-medium pb-2 pr-3">Criterion</th>
            <th className="font-medium pb-2 pr-3">Test QWK</th>
            <th className="font-medium pb-2 pr-3">95% CI</th>
            <th className="font-medium pb-2 pr-3">H-H baseline</th>
            <th className="font-medium pb-2 pr-3 text-right">n</th>
          </tr>
        </thead>
        <tbody>
          {cids.map((cid) => {
            const llm = llmByCid.get(cid);
            const hh = hhByCid.get(cid);
            return (
              <tr key={cid} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3">{nameByCid.get(cid) ?? `criterion ${cid}`}</td>
                <td className="py-2 pr-3 text-[var(--accent)]">{fmt(llm?.value, 3)}</td>
                <td className="py-2 pr-3 text-[var(--fg-muted)]">
                  {llm?.ci_low != null && llm?.ci_high != null
                    ? `[${llm.ci_low.toFixed(2)}, ${llm.ci_high.toFixed(2)}]`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-[var(--fg-muted)]">{fmt(hh?.value, 3)}</td>
                <td className="py-2 pr-3 text-right text-[var(--fg-muted)]">{llm?.n ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
