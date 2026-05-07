/**
 * Disagreement triage feed for one iteration on one split.
 *
 * Lists (app, criterion) pairs where the LLM disagreed with the human median,
 * sorted by |delta| desc. Operators flag each row as 'llm_correct' /
 * 'human_correct' / 'ambiguous'. Flags are project-scoped and survive across
 * iterations — they feed into calibration-example selection.
 */

import { Card } from "../../components/ui/Card";
import {
  useDisagreementCounts,
  useDisagreements,
  useFlagDisagreement,
} from "../../hooks/useDisagreements";
import type { DisagreementFlag, DisagreementItem } from "../../schemas";

interface Props {
  projectId: number;
  iterationId: number;
  split: string;
}

const FLAG_OPTIONS: { value: DisagreementFlag; label: string; color: string }[] = [
  { value: "llm_correct", label: "LLM right", color: "var(--green)" },
  { value: "human_correct", label: "Human right", color: "var(--red)" },
  { value: "ambiguous", label: "Ambiguous", color: "var(--yellow)" },
];

export function DisagreementsPanel({ projectId, iterationId, split }: Props) {
  const feed = useDisagreements(projectId, iterationId, split);
  const counts = useDisagreementCounts(projectId);
  const flag = useFlagDisagreement(projectId);

  const rows = feed.data?.disagreements ?? [];

  return (
    <Card
      title="Disagreements"
      desc={`(LLM, human-median) pairs that diverge on the ${split} split. Sorted by absolute delta.`}
      action={<FlagCounts counts={counts.data?.counts ?? {}} />}
    >
      {feed.isLoading && (
        <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
      )}

      {!feed.isLoading && rows.length === 0 && (
        <div className="text-sm text-[var(--fg-muted)]">
          No disagreements to triage. Run scoring on this split first, or the LLM agrees with humans on every (app, criterion).
        </div>
      )}

      {!feed.isLoading && rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((d) => (
            <DisagreementRow
              key={`${d.application_id}-${d.criterion_id}`}
              d={d}
              onFlag={(value) =>
                flag.mutate({
                  application_id: d.application_id,
                  criterion_id: d.criterion_id,
                  flag: value,
                })
              }
              flagging={flag.isPending}
            />
          ))}
        </div>
      )}

      {flag.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {flag.error.message}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ //

function FlagCounts({ counts }: { counts: Record<string, number> }) {
  const llm = counts.llm_correct ?? 0;
  const human = counts.human_correct ?? 0;
  const amb = counts.ambiguous ?? 0;
  if (llm + human + amb === 0) return null;
  return (
    <div className="flex items-center gap-2 text-xs [font-variant-numeric:tabular-nums]">
      {llm > 0 && (
        <span className="pill pill-green" title="LLM was right">
          {llm} L
        </span>
      )}
      {human > 0 && (
        <span className="pill pill-red" title="Human was right">
          {human} H
        </span>
      )}
      {amb > 0 && (
        <span className="pill pill-yellow" title="Ambiguous">
          {amb} ?
        </span>
      )}
    </div>
  );
}

function DisagreementRow({
  d,
  onFlag,
  flagging,
}: {
  d: DisagreementItem;
  onFlag: (flag: DisagreementFlag) => void;
  flagging: boolean;
}) {
  const deltaSign = d.delta > 0 ? "+" : "";
  return (
    <div className="px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border)]">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-mono truncate">{d.application_external_id}</span>
          <span className="text-xs text-[var(--fg-muted)]">·</span>
          <span className="text-xs font-mono text-[var(--fg-muted)] truncate">
            {d.criterion_name}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 [font-variant-numeric:tabular-nums]">
          <span className="text-xs">
            <span className="text-[var(--fg-muted)]">LLM</span>{" "}
            <span className="font-semibold">{d.llm_score}</span>
          </span>
          <span className="text-xs">
            <span className="text-[var(--fg-muted)]">human</span>{" "}
            <span className="font-semibold">{d.human_median.toFixed(1)}</span>
            <span className="text-[var(--fg-faint)]">
              {" "}
              [{d.human_individual_scores.join(",")}]
            </span>
          </span>
          <span
            className={`text-xs font-semibold ${
              d.delta > 0 ? "text-[var(--green)]" : "text-[var(--red)]"
            }`}
            title="LLM minus human median"
          >
            {deltaSign}
            {d.delta.toFixed(1)}
          </span>
        </div>
      </div>

      {d.excerpt && (
        <div className="text-xs text-[var(--fg-muted)] mb-1.5 line-clamp-2">
          {d.excerpt}
        </div>
      )}

      {d.llm_reasoning && (
        <details className="text-xs text-[var(--fg-muted)] mb-2">
          <summary className="cursor-pointer text-[var(--fg-faint)]">LLM reasoning</summary>
          <div className="pt-1 pl-3 italic">{d.llm_reasoning}</div>
        </details>
      )}

      <div className="flex items-center gap-1.5">
        {FLAG_OPTIONS.map((opt) => {
          const isActive = d.flag === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onFlag(opt.value)}
              disabled={flagging}
              className={`pill text-xs cursor-pointer ${
                isActive ? "pill-active" : ""
              }`}
              style={
                isActive
                  ? { borderColor: opt.color, color: opt.color }
                  : undefined
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
