/**
 * One card on the setup page that consolidates questions + applications.
 * Both are populated by the import wizard from a single CSV/XLSX upload.
 *
 * In setup state, the operator can re-import (replaces everything). After
 * the project advances past setup, the card is read-only.
 */

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";

import { Card } from "../../components/ui/Card";
import { useApplications, useQuestions } from "../../hooks/useDataset";
import { ImportWizard } from "./ImportWizard";
import type { QuestionType } from "../../schemas";

interface Props {
  projectId: number;
  /** True once the project state has advanced past 'setup' — re-import is refused. */
  disabled?: boolean;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  question: "Question",
  demographic: "Demographic",
  metadata: "Metadata",
};

export function DatasetCard({ projectId, disabled }: Props) {
  const questions = useQuestions(projectId);
  const apps = useApplications(projectId);
  const [showWizard, setShowWizard] = useState(false);

  const counts = useMemo(() => {
    const items = questions.data?.questions ?? [];
    return {
      question: items.filter((q) => q.type === "question").length,
      demographic: items.filter((q) => q.type === "demographic").length,
      metadata: items.filter((q) => q.type === "metadata").length,
      total: items.length,
    };
  }, [questions.data]);

  const total = apps.data?.applications.length ?? 0;
  const scored = apps.data?.applications.filter((a) => a.has_human_scores).length ?? 0;
  const isEmpty = counts.total === 0 && total === 0;

  const action = !disabled && (
    <button className="btn btn-sm" onClick={() => setShowWizard(true)}>
      <Upload className="w-3 h-3" />
      {isEmpty ? "Import dataset" : "Re-import"}
    </button>
  );

  return (
    <>
      <Card
        title="Dataset"
        desc="Questions + applications + (optional) demographic / metadata columns. Upload one CSV or Excel; tag the columns; the rest is automatic."
        action={action}
      >
        {questions.isLoading || apps.isLoading ? (
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        ) : isEmpty ? (
          <div className="text-sm text-[var(--fg-muted)]">
            No data yet. Click <em>Import dataset</em> to upload a CSV or Excel file.
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Applications" value={total} />
              <Stat label="Questions" value={counts.question} />
              <Stat label="Demographic fields" value={counts.demographic} muted={counts.demographic === 0} />
              <Stat label="Metadata fields" value={counts.metadata} muted={counts.metadata === 0} />
            </div>
            {total > 0 && (
              <div className="text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums]">
                {scored}/{total} applications have at least one human score.
              </div>
            )}
            {counts.total > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--fg-faint)] hover:text-[var(--fg)]">
                  Inspect columns
                </summary>
                <ul className="mt-2 grid gap-1">
                  {(questions.data?.questions ?? []).map((q) => (
                    <li
                      key={q.id}
                      className="flex items-baseline gap-2 px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)]"
                    >
                      <span className="font-mono text-[var(--fg-muted)] shrink-0">
                        {q.key}
                      </span>
                      <span className="pill text-xs shrink-0">
                        {TYPE_LABEL[q.type]}
                      </span>
                      <span className="text-[var(--fg)] truncate">{q.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Card>

      {showWizard && (
        <ImportWizard
          projectId={projectId}
          onClose={() => setShowWizard(false)}
          onComplete={() => setShowWizard(false)}
        />
      )}
    </>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)]">
      <div className="text-xs text-[var(--fg-muted)] mb-0.5">{label}</div>
      <div
        className={`text-xl font-semibold [font-variant-numeric:tabular-nums] ${
          muted ? "text-[var(--fg-faint)]" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
