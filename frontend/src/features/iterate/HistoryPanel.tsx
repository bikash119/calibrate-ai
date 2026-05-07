/**
 * History tab — full timeline of every iteration in this project, with QWK
 * trend sparklines for both splits and an inline switcher button.
 *
 * Data is the same `iterations.data` already loaded for the sidebar; this view
 * just gives it more room to breathe.
 */
import { ArrowRight } from "lucide-react";

import { Card } from "../../components/ui/Card";
import { Spark } from "../../components/ui/Spark";
import type { IterationItem } from "../../schemas";

interface Props {
  iterations: IterationItem[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

export function HistoryPanel({ iterations, activeId, onSelect }: Props) {
  if (iterations.length === 0) {
    return (
      <Card title="History">
        <div className="text-sm text-[var(--fg-muted)]">
          No iterations yet.
        </div>
      </Card>
    );
  }

  // Ascending order so the sparkline reads left-to-right (v1 → vN).
  const ascending = [...iterations].sort((a, b) => a.version - b.version);
  const devTrend = ascending
    .map((it) => it.overall_dev_qwk)
    .filter((v): v is number => v != null);
  const valTrend = ascending
    .map((it) => it.overall_validation_qwk)
    .filter((v): v is number => v != null);

  // Latest first for the table — operators usually scan recent first.
  const descending = [...iterations].sort((a, b) => b.version - a.version);

  return (
    <Card
      title="History"
      desc="Iteration timeline with overall QWK on each split. Click any row to switch."
      action={
        <div className="flex items-center gap-3 text-xs">
          {devTrend.length >= 2 && (
            <span className="flex items-center gap-1.5 text-[var(--fg-muted)]">
              dev <Spark values={devTrend} color="var(--accent)" />
            </span>
          )}
          {valTrend.length >= 2 && (
            <span className="flex items-center gap-1.5 text-[var(--fg-muted)]">
              val <Spark values={valTrend} color="var(--green)" />
            </span>
          )}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="text-left text-xs text-[var(--fg-muted)]">
              <th className="font-medium pb-2 pr-3">Version</th>
              <th className="font-medium pb-2 pr-3">Created</th>
              <th className="font-medium pb-2 pr-3">Note</th>
              <th className="font-medium pb-2 pr-3 text-right">Dev QWK</th>
              <th className="font-medium pb-2 pr-3 text-right">Val QWK</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {descending.map((it) => {
              const isActive = it.id === activeId;
              return (
                <tr
                  key={it.id}
                  className={`border-t border-[var(--border)] ${
                    isActive ? "bg-[var(--accent-bg)]" : ""
                  }`}
                >
                  <td className="py-2 pr-3 font-semibold">v{it.version}</td>
                  <td className="py-2 pr-3 text-[var(--fg-muted)]">
                    {it.created_at ? formatDate(it.created_at) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-[var(--fg-muted)] max-w-[280px] truncate">
                    {it.note || (
                      <span className="text-[var(--fg-faint)] italic">none</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {fmt(it.overall_dev_qwk)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {fmt(it.overall_validation_qwk)}
                  </td>
                  <td className="py-2 text-right">
                    {!isActive ? (
                      <button
                        className="btn btn-sm"
                        onClick={() => onSelect(it.id)}
                        title={`Switch workbench to v${it.version}`}
                      >
                        Open <ArrowRight className="w-3 h-3" />
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--accent)] font-medium">
                        active
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function fmt(v: number | null): string {
  return v != null ? v.toFixed(3) : "—";
}

function formatDate(iso: string): string {
  // "2026-05-07 14:32" — short local timestamp, dropping seconds.
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}
