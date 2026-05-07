/**
 * Three-phase wizard for uploading human scores in wide format.
 *
 *   1. Drop / paste CSV with one row per application and one column per
 *      (evaluator, criterion).
 *   2. Review the auto-detected pivot plan; override the id column or any
 *      evaluator / criterion mapping that came out wrong.
 *   3. Preview the long-form output + coverage matrix, then upload.
 *
 * Layout detection lives in `lib/humanScoresWide.ts`. This file is the UI
 * shell + state machine.
 */
import { useMemo, useState } from "react";
import { ChevronRight, Upload, X } from "lucide-react";

import { CsvParseError, parseCsv } from "../../lib/csv";
import {
  detectLayout,
  firstUnmappedColumn,
  isPlanReady,
  overrideMapping,
  pivotRows,
  setIdColumn,
  type CoverageMap,
  type LongRow,
  type PivotPlan,
} from "../../lib/humanScoresWide";

type Phase = "input" | "review" | "preview";

interface Props {
  criteriaNames: string[];
  onClose: () => void;
  onSubmit: (rows: LongRow[]) => Promise<void>;
  /** Optional escape hatch — clicking this should close the wide modal and
   *  open the long-form modal in the parent. */
  onSwitchToLong?: () => void;
  submitting: boolean;
  error: string | null;
}

export function WideUploadModal({
  criteriaNames,
  onClose,
  onSubmit,
  onSwitchToLong,
  submitting,
  error,
}: Props) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PivotPlan | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const onFile = (file: File) => {
    void file.text().then((t) => {
      setText(t);
      setParseError(null);
    });
  };

  const goReview = () => {
    setParseError(null);
    try {
      const csv = parseCsv(text);
      if (csv.rows.length === 0) {
        setParseError("CSV contains no data rows.");
        return;
      }
      setHeaders(csv.headers);
      setParsedRows(csv.rows);
      setPlan(detectLayout(csv.headers, criteriaNames));
      setPhase("review");
    } catch (e) {
      setParseError(
        e instanceof CsvParseError
          ? e.message
          : `Couldn't parse CSV: ${(e as Error).message}`,
      );
    }
  };

  const goPreview = () => {
    if (!plan) return;
    setPhase("preview");
  };

  const result = useMemo(() => {
    if (!plan) return null;
    return pivotRows(plan, parsedRows);
  }, [plan, parsedRows]);

  const handleSubmit = async () => {
    if (!result) return;
    await onSubmit(result.rows);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">
              Upload human scores (wide format)
            </h3>
            <p className="text-xs text-[var(--fg-muted)] mt-0.5">
              One row per application; one column per (evaluator, criterion).
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <PhaseStrip phase={phase} />

        <div className="px-5 py-4 grid gap-3 overflow-y-auto">
          {phase === "input" && (
            <InputPhase
              text={text}
              setText={setText}
              onFile={onFile}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              parseError={parseError}
              onSwitchToLong={onSwitchToLong}
            />
          )}

          {phase === "review" && plan && (
            <ReviewPhase
              plan={plan}
              headers={headers}
              criteriaNames={criteriaNames}
              onIdColumnChange={(h) => setPlan(setIdColumn(plan, h))}
              onMappingChange={(header, patch) =>
                setPlan(overrideMapping(plan, header, patch, criteriaNames))
              }
            />
          )}

          {phase === "preview" && result && (
            <PreviewPhase
              rows={result.rows}
              issues={result.issues}
              coverage={result.coverage}
              evaluators={result.evaluators}
              criteria={result.criteria}
            />
          )}

          {error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-between gap-2">
          <button
            className="btn"
            onClick={() => {
              if (phase === "review") setPhase("input");
              else if (phase === "preview") setPhase("review");
              else onClose();
            }}
            disabled={submitting}
          >
            {phase === "input" ? "Cancel" : "Back"}
          </button>
          <div className="flex gap-2">
            {phase === "input" && (
              <button
                className="btn btn-primary"
                onClick={goReview}
                disabled={!text.trim()}
              >
                Continue
              </button>
            )}
            {phase === "review" && plan && (
              <button
                className="btn btn-primary"
                onClick={goPreview}
                disabled={!isPlanReady(plan)}
                title={
                  isPlanReady(plan)
                    ? undefined
                    : `Map every column first — '${firstUnmappedColumn(plan)}' still needs a criterion.`
                }
              >
                Continue
              </button>
            )}
            {phase === "preview" && result && (
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={submitting || result.rows.length === 0}
              >
                <Upload className="w-3 h-3" />
                {submitting
                  ? "Uploading…"
                  : `Upload ${result.rows.length.toLocaleString()} score${result.rows.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //

function PhaseStrip({ phase }: { phase: Phase }) {
  const steps: { id: Phase; label: string }[] = [
    { id: "input", label: "Upload CSV" },
    { id: "review", label: "Review mapping" },
    { id: "preview", label: "Preview & confirm" },
  ];
  const idx = steps.findIndex((s) => s.id === phase);
  return (
    <div className="px-5 py-2 border-b border-[var(--border)] flex items-center gap-2 text-xs">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                active
                  ? "bg-[var(--accent)] text-white"
                  : done
                    ? "bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green-border)]"
                    : "bg-[var(--bg-sunken)] text-[var(--fg-muted)] border border-[var(--border)]"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={
                active
                  ? "font-medium"
                  : done
                    ? "text-[var(--fg-muted)]"
                    : "text-[var(--fg-faint)]"
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight className="w-3 h-3 text-[var(--fg-faint)]" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ //

function InputPhase({
  text,
  setText,
  onFile,
  isDragging,
  setIsDragging,
  parseError,
  onSwitchToLong,
}: {
  text: string;
  setText: (t: string) => void;
  onFile: (f: File) => void;
  isDragging: boolean;
  setIsDragging: (b: boolean) => void;
  parseError: string | null;
  onSwitchToLong?: () => void;
}) {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  return (
    <>
      <div className="text-xs text-[var(--fg-muted)]">
        Each row is one application. Each non-id column is named like{" "}
        <code className="text-[var(--fg)]">evaluator_criterion</code> (e.g.{" "}
        <code className="text-[var(--fg)]">alice_team</code>). Common separators
        are <code>_</code>, <code>.</code>, and <code> - </code>.
      </div>
      <pre className="text-xs bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 overflow-x-auto font-[var(--font-mono)]">
{`external_id,alice_team,bob_team,alice_market,bob_market
app-001,4,5,3,4
app-002,3,3,5,4
app-003,5,5,4,5`}
      </pre>

      <label className="text-xs text-[var(--fg-muted)] cursor-pointer hover:text-[var(--fg)] self-end">
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        Choose CSV file…
      </label>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragging(false);
        }}
        className={`rounded-[var(--radius-sm)] border-2 transition-colors ${
          isDragging
            ? "border-[var(--accent)] border-dashed bg-[var(--accent-bg)]"
            : "border-transparent"
        }`}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-xs font-[var(--font-mono)] focus:outline-none focus:border-[var(--accent)]"
          placeholder="Paste CSV here, or drop a file"
          spellCheck={false}
        />
      </div>

      {parseError && (
        <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {parseError}
        </div>
      )}

      {onSwitchToLong && (
        <button
          type="button"
          onClick={onSwitchToLong}
          className="text-xs text-[var(--fg-muted)] hover:text-[var(--accent)] underline self-start"
        >
          Have long-format CSV instead? (one row per evaluator × app × criterion)
        </button>
      )}
    </>
  );
}

// ------------------------------------------------------------------ //

function ReviewPhase({
  plan,
  headers,
  criteriaNames,
  onIdColumnChange,
  onMappingChange,
}: {
  plan: PivotPlan;
  headers: string[];
  criteriaNames: string[];
  onIdColumnChange: (header: string | null) => void;
  onMappingChange: (
    header: string,
    patch: { evaluator?: string | null; criterion?: string | null },
  ) => void;
}) {
  const matched = plan.columns.filter((c) => c.criterionMatched).length;
  return (
    <>
      <div className="text-xs text-[var(--fg-muted)]">
        Auto-detected{" "}
        <span className="text-[var(--fg)] font-semibold">{matched}</span>/
        <span className="text-[var(--fg)] font-semibold">{plan.columns.length}</span>{" "}
        columns from your rubric. Review and fix any unmapped columns before
        continuing.
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-[var(--fg-muted)]">
          Application id column
        </span>
        <select
          value={plan.idColumn ?? ""}
          onChange={(e) => onIdColumnChange(e.target.value || null)}
          className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">— pick a column —</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <span className="text-xs font-medium text-[var(--fg-muted)]">
          Score columns
        </span>
        <div className="border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-sunken)] text-[var(--fg-muted)]">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Column</th>
                <th className="text-left px-3 py-1.5 font-medium">Evaluator</th>
                <th className="text-left px-3 py-1.5 font-medium">Criterion</th>
              </tr>
            </thead>
            <tbody>
              {plan.columns.map((c) => {
                const ok = c.criterionMatched && !!c.evaluator;
                return (
                  <tr
                    key={c.header}
                    className={`border-t border-[var(--border)] ${
                      ok ? "" : "bg-[var(--yellow-bg)]"
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-[var(--fg-muted)] truncate max-w-[200px]">
                      {c.header}
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={c.evaluator ?? ""}
                        onChange={(e) =>
                          onMappingChange(c.header, {
                            evaluator: e.target.value || null,
                          })
                        }
                        placeholder="evaluator id"
                        className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={c.criterion ?? ""}
                        onChange={(e) =>
                          onMappingChange(c.header, {
                            criterion: e.target.value || null,
                          })
                        }
                        className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                      >
                        <option value="">— pick —</option>
                        {criteriaNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ //

function PreviewPhase({
  rows,
  issues,
  coverage,
  evaluators,
  criteria,
}: {
  rows: LongRow[];
  issues: { kind: string; message: string }[];
  coverage: CoverageMap;
  evaluators: string[];
  criteria: string[];
}) {
  return (
    <>
      <div className="text-xs text-[var(--fg-muted)]">
        Pivoted{" "}
        <span className="text-[var(--fg)] font-semibold [font-variant-numeric:tabular-nums]">
          {rows.length}
        </span>{" "}
        long-form rows from{" "}
        <span className="text-[var(--fg)] font-semibold">{evaluators.length}</span>{" "}
        evaluator{evaluators.length === 1 ? "" : "s"} ×{" "}
        <span className="text-[var(--fg)] font-semibold">{criteria.length}</span>{" "}
        criteri{criteria.length === 1 ? "on" : "a"}.
      </div>

      {/* Coverage matrix */}
      <div className="grid gap-1">
        <span className="text-xs font-medium text-[var(--fg-muted)]">
          Coverage (apps scored per evaluator × criterion)
        </span>
        <CoverageGrid
          evaluators={evaluators}
          criteria={criteria}
          coverage={coverage}
        />
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--yellow)]">
            {issues.length} issue{issues.length === 1 ? "" : "s"} — review
            before uploading
          </summary>
          <ul className="mt-2 pl-4 grid gap-1 list-disc text-[var(--fg-muted)]">
            {issues.slice(0, 30).map((iss, i) => (
              <li key={i}>{iss.message}</li>
            ))}
            {issues.length > 30 && (
              <li className="text-[var(--fg-faint)]">
                …and {issues.length - 30} more
              </li>
            )}
          </ul>
        </details>
      )}

      {/* Long-form sample */}
      <div className="grid gap-1">
        <span className="text-xs font-medium text-[var(--fg-muted)]">
          Sample (first 5 rows)
        </span>
        <pre className="text-xs bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 overflow-x-auto max-h-40 font-[var(--font-mono)]">
          {JSON.stringify(rows.slice(0, 5), null, 2)}
        </pre>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ //

export function CoverageGrid({
  evaluators,
  criteria,
  coverage,
}: {
  evaluators: string[];
  criteria: string[];
  coverage: CoverageMap;
}) {
  // Find max count for color scaling.
  let maxCount = 0;
  for (const inner of coverage.values()) {
    for (const n of inner.values()) {
      if (n > maxCount) maxCount = n;
    }
  }
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden">
      <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
        <thead className="bg-[var(--bg-sunken)] text-[var(--fg-muted)]">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium">Evaluator</th>
            {criteria.map((c) => (
              <th key={c} className="text-right px-3 py-1.5 font-medium">
                {c}
              </th>
            ))}
            <th className="text-right px-3 py-1.5 font-medium border-l border-[var(--border)]">
              total
            </th>
          </tr>
        </thead>
        <tbody>
          {evaluators.map((e) => {
            const row = coverage.get(e);
            const total = row
              ? Array.from(row.values()).reduce((a, b) => a + b, 0)
              : 0;
            return (
              <tr key={e} className="border-t border-[var(--border)]">
                <td className="px-3 py-1.5 font-mono">{e}</td>
                {criteria.map((c) => {
                  const n = row?.get(c) ?? 0;
                  const intensity = maxCount > 0 ? n / maxCount : 0;
                  return (
                    <td
                      key={c}
                      className="text-right px-3 py-1.5"
                      style={{
                        background:
                          n === 0
                            ? "transparent"
                            : `color-mix(in oklab, var(--green-bg) ${Math.round(intensity * 100)}%, transparent)`,
                        color: n === 0 ? "var(--fg-faint)" : "var(--fg)",
                      }}
                    >
                      {n}
                    </td>
                  );
                })}
                <td className="text-right px-3 py-1.5 font-semibold border-l border-[var(--border)]">
                  {total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
