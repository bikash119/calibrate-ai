import { Sparkles } from "lucide-react";

import { Card } from "../../components/ui/Card";
import type { IterationItem } from "../../schemas";

interface Props {
  iterations: IterationItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAutoGenerate: () => void;
  isGenerating: boolean;
  generateError: string | null;
  disabled?: boolean;
}

export function IterationsList({
  iterations,
  selectedId,
  onSelect,
  onAutoGenerate,
  isGenerating,
  generateError,
  disabled,
}: Props) {
  const sorted = [...iterations].sort((a, b) => b.version - a.version);
  const isEmpty = sorted.length === 0;

  return (
    <Card
      title="Iterations"
      desc={
        isEmpty
          ? "Auto-generate v1 from your rubric to start."
          : "Versioned prompt sets. Latest at the top."
      }
    >
      {isEmpty ? (
        <button
          className="btn btn-primary"
          onClick={onAutoGenerate}
          disabled={isGenerating || disabled}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isGenerating ? "Generating…" : "Auto-generate v1"}
        </button>
      ) : (
        <div className="grid gap-1.5">
          {sorted.map((it) => {
            const isActive = it.id === selectedId;
            return (
              <button
                key={it.id}
                onClick={() => onSelect(it.id)}
                className={`text-left px-3 py-2 rounded-[var(--radius-sm)] border transition-colors ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-bg)]"
                    : "border-[var(--border)] hover:border-[var(--border-strong)]"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">v{it.version}</span>
                  <span className="text-xs text-[var(--fg-faint)] [font-variant-numeric:tabular-nums]">
                    {it.created_at ? relative(it.created_at) : ""}
                  </span>
                </div>
                {it.note && (
                  <div className="text-xs text-[var(--fg-muted)] truncate mt-0.5">
                    {it.note}
                  </div>
                )}
                <div className="text-xs mt-1 [font-variant-numeric:tabular-nums]">
                  <MetricBadge label="dev" qwk={it.overall_dev_qwk} />
                  <MetricBadge label="val" qwk={it.overall_validation_qwk} />
                </div>
              </button>
            );
          })}
          <button
            className="btn btn-sm mt-1"
            onClick={onAutoGenerate}
            disabled={isGenerating || disabled}
            title="Re-generate from rubric, including current active calibration examples"
          >
            <Sparkles className="w-3 h-3" />
            {isGenerating ? "Generating…" : "Auto-generate new"}
          </button>
        </div>
      )}
      {generateError && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {generateError}
        </div>
      )}
    </Card>
  );
}

function MetricBadge({ label, qwk }: { label: string; qwk: number | null }) {
  return (
    <span className="text-[var(--fg-muted)] mr-2">
      {label}{" "}
      <span className="text-[var(--fg)]">{qwk != null ? qwk.toFixed(2) : "—"}</span>
    </span>
  );
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
