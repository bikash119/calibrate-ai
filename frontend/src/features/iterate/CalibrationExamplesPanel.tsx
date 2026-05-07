/**
 * Per-criterion calibration examples — generate, view, toggle active.
 *
 * Active examples are injected into auto-generated iteration prompts. The
 * "Generate" call replaces all existing examples for the chosen criterion
 * (operator-flagged → consensus → median priority), and synthesizes
 * reasoning via the LLM. It's synchronous and takes a few seconds.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { Card } from "../../components/ui/Card";
import {
  useCalibrationExamples,
  useGenerateCalibrationExamples,
  useSetExampleActive,
} from "../../hooks/useCalibration";
import { useRubric } from "../../hooks/useRubric";
import type { CalibrationExampleItem } from "../../schemas";

interface Props {
  projectId: number;
  /** Initially selected criterion (e.g. lifted from the iteration). Optional. */
  initialCriterionId?: number;
}

export function CalibrationExamplesPanel({ projectId, initialCriterionId }: Props) {
  const rubric = useRubric(projectId);
  const criteria = rubric.data?.criteria ?? [];
  const [criterionId, setCriterionId] = useState<number | undefined>(initialCriterionId);

  // Fall back to the first criterion if nothing selected and rubric is loaded
  const effectiveCid = criterionId ?? criteria[0]?.id;

  const examples = useCalibrationExamples(projectId, effectiveCid);
  const generate = useGenerateCalibrationExamples(projectId, effectiveCid ?? 0);
  const setActive = useSetExampleActive(projectId, effectiveCid ?? 0);

  const [maxExamples, setMaxExamples] = useState(3);

  const items = examples.data?.examples ?? [];
  const activeCount = items.filter((e) => e.is_active).length;

  return (
    <Card
      title="Calibration examples"
      desc="Few-shot examples injected into auto-generated prompts. Operator-flagged → evaluator-consensus → median fallback, with one example per score level if possible."
      action={
        <div className="flex items-center gap-2">
          <select
            value={effectiveCid ?? ""}
            onChange={(e) => setCriterionId(Number(e.target.value))}
            className="px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)]"
          >
            {criteria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={10}
            value={maxExamples}
            onChange={(e) => setMaxExamples(Math.max(1, Math.min(10, Number(e.target.value) || 3)))}
            className="w-12 px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] [font-variant-numeric:tabular-nums]"
            title="Max examples"
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={!effectiveCid || generate.isPending}
            onClick={() => generate.mutate(maxExamples)}
          >
            <Sparkles className="w-3 h-3" />
            {generate.isPending ? "Generating…" : "Generate"}
          </button>
        </div>
      }
    >
      {!effectiveCid && (
        <div className="text-sm text-[var(--fg-muted)]">Define a rubric first.</div>
      )}

      {effectiveCid && examples.isLoading && (
        <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
      )}

      {effectiveCid && !examples.isLoading && items.length === 0 && (
        <div className="text-sm text-[var(--fg-muted)]">
          No examples for this criterion yet. Click <em>Generate</em> to build them
          from human-scored applications.
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="text-xs text-[var(--fg-muted)] mb-3 [font-variant-numeric:tabular-nums]">
            {activeCount}/{items.length} active. Inactive examples are excluded from auto-generated prompts.
          </div>
          <div className="grid gap-2">
            {items.map((ex) => (
              <ExampleRow
                key={ex.id}
                example={ex}
                onToggle={(isActive) =>
                  setActive.mutate({ exampleId: ex.id, isActive })
                }
                disabled={setActive.isPending}
              />
            ))}
          </div>
        </>
      )}

      {generate.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {generate.error.message}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ //

function ExampleRow({
  example,
  onToggle,
  disabled,
}: {
  example: CalibrationExampleItem;
  onToggle: (isActive: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`px-3 py-2.5 rounded-[var(--radius-sm)] border ${
        example.is_active ? "border-[var(--border)]" : "border-[var(--border)] opacity-60"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-mono">{example.application_external_id}</span>
          <span className="pill pill-info text-xs">score {example.human_score}</span>
          <span className="text-xs text-[var(--fg-faint)]">{example.source}</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={example.is_active}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={disabled}
          />
          <span className="text-[var(--fg-muted)]">Active</span>
        </label>
      </div>

      <div className="text-xs italic text-[var(--fg-muted)] mb-2">
        {example.synthesized_reasoning}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--fg-faint)]">
          Condensed answers ({example.condensed_answers.length})
        </summary>
        <div className="grid gap-1 pt-1.5 pl-3">
          {example.condensed_answers.map((ans, i) => {
            const a = ans as { question_key?: string; answer_text?: string; is_weighted?: boolean };
            return (
              <div key={i} className="text-xs">
                <span className="font-mono text-[var(--fg-muted)]">
                  {a.question_key}
                  {a.is_weighted ? " ★" : ""}
                </span>
                <span className="text-[var(--fg-muted)]">: </span>
                <span>{a.answer_text}</span>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
