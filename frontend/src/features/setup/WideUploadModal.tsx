/**
 * Four-phase wizard for uploading human scores in wide format.
 *
 *   1. upload  — drop a CSV/XLSX file; backend parses to a 2D grid.
 *   2. header  — pick which row is the header (and where data starts) on
 *                the grid preview. Mirrors the dataset-import wizard so
 *                multi-row-header spreadsheets don't silently bind to the
 *                wrong row.
 *   3. review  — auto-detected (id, evaluator, criterion) per column;
 *                operator overrides anything that came out wrong.
 *   4. preview — coverage matrix + sample, then upload (long-form JSON).
 *
 * Layout detection lives in `lib/humanScoresWide.ts`. This file is the UI
 * shell + state machine.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Upload, X } from "lucide-react";

import { useHumanScoresPreview } from "../../hooks/useDataset";
import {
  detectLayout,
  firstUnmappedColumn,
  isPlanReady,
  overrideMapping,
  pivotRows,
  setFileEvaluator as setPlanFileEvaluator,
  setIdColumn,
  setLayout,
  sliceGridForPivot,
  type CoverageMap,
  type LongRow,
  type PivotPlan,
  type ScoreUploadLayout,
} from "../../lib/humanScoresWide";
import {
  applyCacheToPlan,
  loadCache,
  planToCache,
  saveCache,
} from "../../lib/wideUploadCache";
import type { ImportPreviewResponse } from "../../schemas";

type Phase = "upload" | "header" | "review" | "preview";

interface Props {
  projectId: number;
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
  projectId,
  criteriaNames,
  onClose,
  onSubmit,
  onSwitchToLong,
  submitting,
  error,
}: Props) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [dataStartIndex, setDataStartIndex] = useState(1);
  const [plan, setPlan] = useState<PivotPlan | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // True when the current plan was pre-filled from a previous upload's
  // cache. Surface a banner so the operator knows to verify, not just
  // click through.
  const [usedCache, setUsedCache] = useState(false);

  const previewMut = useHumanScoresPreview(projectId);

  const handleFile = async (file: File) => {
    previewMut.reset();
    try {
      const r = await previewMut.mutateAsync(file);
      setPreview(r);
      setActiveSheet(r.suggested_sheet);
      setHeaderRowIndex(0);
      setDataStartIndex(1);
      // Reset all overrides — a fresh file means we re-detect, then layer the
      // cache on top in the effect below.
      setOverrides({});
      setLayoutOverride(null);
      setEvaluatorInput("");
      setUsedCache(false);
      setPhase("header");
    } catch {
      // surfaced via previewMut.error below
    }
  };

  const { headers, rows: dataRows } = useMemo(() => {
    if (!preview) return { headers: [] as string[], rows: [] as Record<string, string>[] };
    return sliceGridForPivot(preview.preview.rows, headerRowIndex, dataStartIndex);
  }, [preview, headerRowIndex, dataStartIndex]);

  // Recompute the layout plan whenever the operator changes the header row.
  // Stash user overrides per-column so picking a different header row
  // doesn't blow away their fixes. Layout + fileEvaluator are tracked
  // separately so they also survive a re-detect.
  const [overrides, setOverrides] = useState<
    Record<
      string,
      { evaluator?: string | null; criterion?: string | null; excluded?: boolean }
    >
  >({});
  const [layoutOverride, setLayoutOverride] = useState<ScoreUploadLayout | null>(null);
  const [evaluatorInput, setEvaluatorInput] = useState<string>("");
  useEffect(() => {
    if (phase !== "header" && phase !== "review") return;
    if (headers.length === 0) {
      setPlan(null);
      return;
    }
    let next = detectLayout(headers, criteriaNames);
    // Apply the project's cached mapping from a previous upload, if any.
    // Operator overrides made *this* session win over the cache, so the
    // cache is layered first.
    const cached = loadCache(projectId);
    if (cached) {
      next = applyCacheToPlan(next, cached);
      setUsedCache(true);
    }
    if (layoutOverride) next = setLayout(next, layoutOverride);
    if (evaluatorInput) next = setPlanFileEvaluator(next, evaluatorInput);
    for (const [header, patch] of Object.entries(overrides)) {
      next = overrideMapping(next, header, patch, criteriaNames);
    }
    setPlan(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers.join("|")]);

  const result = useMemo(() => {
    if (!plan) return null;
    return pivotRows(plan, dataRows);
  }, [plan, dataRows]);

  const handleSubmit = async () => {
    if (!result || !plan) return;
    await onSubmit(result.rows);
    // Save the mapping so the next evaluator file inherits it. We persist
    // *after* onSubmit resolves so a failed upload doesn't pin a bad mapping.
    saveCache(projectId, planToCache(plan));
  };

  const stepBack = () => {
    if (phase === "header") setPhase("upload");
    else if (phase === "review") setPhase("header");
    else if (phase === "preview") setPhase("review");
    else onClose();
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
          {phase === "upload" && (
            <UploadPhase
              onFile={handleFile}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              loading={previewMut.isPending}
              parseError={previewMut.error?.message ?? null}
              onSwitchToLong={onSwitchToLong}
            />
          )}

          {phase === "header" && preview && (
            <HeaderPhase
              preview={preview}
              activeSheet={activeSheet}
              onChangeSheet={setActiveSheet}
              headerRowIndex={headerRowIndex}
              onChangeHeaderRow={(n) => {
                setHeaderRowIndex(n);
                setDataStartIndex(Math.max(n + 1, dataStartIndex));
              }}
              dataStartIndex={dataStartIndex}
              onChangeDataStart={setDataStartIndex}
            />
          )}

          {phase === "review" && plan && (
            <ReviewPhase
              plan={plan}
              headers={headers}
              criteriaNames={criteriaNames}
              usedCache={usedCache}
              onIdColumnChange={(h) => setPlan(setIdColumn(plan, h))}
              onLayoutChange={(l) => {
                setLayoutOverride(l);
                setPlan(setLayout(plan, l));
              }}
              onFileEvaluatorChange={(v) => {
                setEvaluatorInput(v);
                setPlan(setPlanFileEvaluator(plan, v || null));
              }}
              onMappingChange={(header, patch) => {
                setOverrides((o) => ({ ...o, [header]: { ...o[header], ...patch } }));
                setPlan(overrideMapping(plan, header, patch, criteriaNames));
              }}
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
          <button className="btn" onClick={stepBack} disabled={submitting}>
            {phase === "upload" ? "Cancel" : "Back"}
          </button>
          <div className="flex gap-2">
            {phase === "header" && (
              <button
                className="btn btn-primary"
                onClick={() => setPhase("review")}
                disabled={headers.length === 0 || dataRows.length === 0}
                title={
                  dataRows.length === 0
                    ? "No data rows after the chosen start row — adjust the header row or data start."
                    : undefined
                }
              >
                Continue
              </button>
            )}
            {phase === "review" && plan && (
              <button
                className="btn btn-primary"
                onClick={() => setPhase("preview")}
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
    { id: "upload", label: "Upload file" },
    { id: "header", label: "Pick header row" },
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

function UploadPhase({
  onFile,
  isDragging,
  setIsDragging,
  loading,
  parseError,
  onSwitchToLong,
}: {
  onFile: (f: File) => void;
  isDragging: boolean;
  setIsDragging: (b: boolean) => void;
  loading: boolean;
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
        are <code>_</code>, <code>.</code>, and <code> - </code>. CSV or XLSX.
      </div>
      <pre className="text-xs bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 overflow-x-auto font-[var(--font-mono)]">
{`external_id,alice_team,bob_team,alice_market,bob_market
app-001,4,5,3,4
app-002,3,3,5,4
app-003,5,5,4,5`}
      </pre>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragging(false);
        }}
        className={`rounded-[var(--radius-sm)] border-2 border-dashed transition-colors px-4 py-8 text-center ${
          isDragging
            ? "border-[var(--accent)] bg-[var(--accent-bg)]"
            : "border-[var(--border)] bg-[var(--bg-sunken)]"
        }`}
      >
        <label className="cursor-pointer text-sm text-[var(--fg)] hover:text-[var(--accent)]">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={loading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          {loading ? "Parsing…" : "Choose a CSV or XLSX file"}
        </label>
        <div className="text-xs text-[var(--fg-muted)] mt-1">or drop it here</div>
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

function HeaderPhase({
  preview,
  activeSheet,
  onChangeSheet,
  headerRowIndex,
  onChangeHeaderRow,
  dataStartIndex,
  onChangeDataStart,
}: {
  preview: ImportPreviewResponse;
  activeSheet: string | null;
  onChangeSheet: (s: string) => void;
  headerRowIndex: number;
  onChangeHeaderRow: (n: number) => void;
  dataStartIndex: number;
  onChangeDataStart: (n: number) => void;
}) {
  const grid = preview.preview.rows;
  const numRows = grid.length;
  const numCols = useMemo(
    () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    [grid],
  );
  // Limit the on-screen preview so a very large grid doesn't blow out layout.
  const maxRowsShown = 25;
  const rowsShown = Math.min(numRows, maxRowsShown);

  return (
    <>
      <div className="text-xs text-[var(--fg-muted)]">
        Click the row that holds your column headers (e.g.{" "}
        <code>external_id, alice_team, bob_team</code>). If your file has a
        category or title row above the real headers, bump up the indices.
      </div>

      {preview.format === "xlsx" && preview.sheets.length > 1 && (
        <Field label="Sheet">
          <select
            value={activeSheet ?? preview.suggested_sheet}
            onChange={(e) => onChangeSheet(e.target.value)}
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm"
          >
            {preview.sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.rows} rows × {s.columns} cols)
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--fg-faint)]">
            Preview always shows the first sheet — re-upload to inspect another.
          </span>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Header row"
          hint="0-indexed. Defaults to the first row."
        >
          <input
            type="number"
            min={0}
            max={Math.max(0, numRows - 1)}
            value={headerRowIndex}
            onChange={(e) =>
              onChangeHeaderRow(
                Math.max(
                  0,
                  Math.min(numRows - 1, Number(e.target.value) || 0),
                ),
              )
            }
            className="w-24 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm [font-variant-numeric:tabular-nums]"
          />
        </Field>
        <Field
          label="Data starts at row"
          hint="Typically header row + 1."
        >
          <input
            type="number"
            min={headerRowIndex + 1}
            max={Math.max(headerRowIndex + 1, numRows - 1)}
            value={dataStartIndex}
            onChange={(e) =>
              onChangeDataStart(
                Math.max(
                  headerRowIndex + 1,
                  Math.min(numRows - 1, Number(e.target.value) || headerRowIndex + 1),
                ),
              )
            }
            className="w-24 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm [font-variant-numeric:tabular-nums]"
          />
        </Field>
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] overflow-x-auto max-h-72">
        <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
          <thead className="bg-[var(--bg-sunken)] text-[var(--fg-muted)] sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium w-12">#</th>
              {Array.from({ length: numCols }, (_, c) => (
                <th key={c} className="text-left px-3 py-1.5 font-medium">
                  col {c + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowsShown }, (_, r) => {
              const isHeader = r === headerRowIndex;
              const isData = r >= dataStartIndex;
              const cells = grid[r] ?? [];
              return (
                <tr
                  key={r}
                  onClick={() => onChangeHeaderRow(r)}
                  className={`cursor-pointer border-t border-[var(--border)] ${
                    isHeader
                      ? "bg-[var(--accent-bg)] text-[var(--fg)]"
                      : isData
                        ? ""
                        : "text-[var(--fg-faint)]"
                  }`}
                  title="Click to mark as header row"
                >
                  <td className="px-3 py-1 text-[var(--fg-faint)]">{r}</td>
                  {Array.from({ length: numCols }, (_, c) => {
                    const v = cells[c];
                    return (
                      <td
                        key={c}
                        className="px-3 py-1 truncate max-w-xs font-mono"
                        title={v ?? ""}
                      >
                        {v ?? <em className="text-[var(--fg-faint)]">∅</em>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {numRows > maxRowsShown && (
        <div className="text-xs text-[var(--fg-faint)]">
          Showing first {maxRowsShown} of {numRows} rows in preview. Pivot will
          process all rows on the next step.
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ //

function ReviewPhase({
  plan,
  headers,
  criteriaNames,
  usedCache,
  onIdColumnChange,
  onLayoutChange,
  onFileEvaluatorChange,
  onMappingChange,
}: {
  plan: PivotPlan;
  headers: string[];
  criteriaNames: string[];
  usedCache: boolean;
  onIdColumnChange: (header: string | null) => void;
  onLayoutChange: (layout: ScoreUploadLayout) => void;
  onFileEvaluatorChange: (value: string) => void;
  onMappingChange: (
    header: string,
    patch: {
      evaluator?: string | null;
      criterion?: string | null;
      excluded?: boolean;
    },
  ) => void;
}) {
  const mapped = plan.columns.filter(
    (c) => !c.excluded && c.criterion !== null,
  ).length;
  const candidate = plan.columns.filter((c) => !c.excluded).length;
  const isPerFile = plan.layout === "per-file";

  return (
    <>
      {usedCache && (
        <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--blue-bg)] border border-[var(--blue-border)] text-[var(--blue-fg)]">
          Loaded column mappings from your previous upload for this project.
          Verify them below before continuing — adjust anything that's
          changed for this evaluator's file.
        </div>
      )}
      <div className="text-xs text-[var(--fg-muted)]">
        <span className="text-[var(--fg)] font-semibold">{mapped}</span>/
        <span className="text-[var(--fg)] font-semibold">{candidate}</span>{" "}
        score columns mapped. Pick a criterion (or tick Exclude) for any
        unmapped ones.
      </div>

      {/* Layout toggle */}
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-[var(--fg-muted)]">
          File layout
        </span>
        <div className="flex flex-col gap-1.5 text-xs">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="layout"
              checked={isPerFile}
              onChange={() => onLayoutChange("per-file")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">One evaluator per file.</span>{" "}
              <span className="text-[var(--fg-muted)]">
                Each column is one criterion; the file represents a single
                evaluator's scores. Upload one file per evaluator.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="layout"
              checked={!isPerFile}
              onChange={() => onLayoutChange("per-column")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Columns are evaluator_criterion combos.</span>{" "}
              <span className="text-[var(--fg-muted)]">
                Each column is named like <code>alice_team</code>; one file
                holds every evaluator's scores.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* ID column picker (always shown) */}
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

      {/* Per-file: evaluator id input */}
      {isPerFile && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--fg-muted)]">
            Evaluator ID for this file
          </span>
          <input
            type="text"
            value={plan.fileEvaluator ?? ""}
            onChange={(e) => onFileEvaluatorChange(e.target.value)}
            placeholder="e.g. evaluator_01"
            className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
          />
          <span className="text-xs text-[var(--fg-faint)]">
            Every score in this file will be attributed to this evaluator.
            Re-run the upload for each evaluator's file.
          </span>
        </div>
      )}

      {/* Score column mapping table */}
      <div className="grid gap-1">
        <span className="text-xs font-medium text-[var(--fg-muted)]">
          Score columns
        </span>
        <div className="border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-sunken)] text-[var(--fg-muted)]">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Column</th>
                {!isPerFile && (
                  <th className="text-left px-3 py-1.5 font-medium">Evaluator</th>
                )}
                <th className="text-left px-3 py-1.5 font-medium">Criterion</th>
                <th className="text-left px-3 py-1.5 font-medium" style={{ width: 80 }}>
                  Exclude
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.columns.map((c) => {
                const needsAttention =
                  !c.excluded &&
                  (!c.criterion || (!isPerFile && !c.evaluator));
                return (
                  <tr
                    key={c.header}
                    className={`border-t border-[var(--border)] ${
                      c.excluded
                        ? "opacity-50"
                        : needsAttention
                          ? "bg-[var(--yellow-bg)]"
                          : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-[var(--fg-muted)] truncate max-w-[280px]">
                      {c.header}
                    </td>
                    {!isPerFile && (
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={c.evaluator ?? ""}
                          disabled={c.excluded}
                          onChange={(e) =>
                            onMappingChange(c.header, {
                              evaluator: e.target.value || null,
                            })
                          }
                          placeholder="evaluator id"
                          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                        />
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <select
                        value={c.criterion ?? ""}
                        disabled={c.excluded}
                        onChange={(e) =>
                          onMappingChange(c.header, {
                            criterion: e.target.value || null,
                          })
                        }
                        className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                      >
                        <option value="">— pick —</option>
                        {criteriaNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={c.excluded}
                        onChange={(e) =>
                          onMappingChange(c.header, { excluded: e.target.checked })
                        }
                        title="Drop this column from the upload (e.g. totals, names, demographics)"
                      />
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-[var(--fg-muted)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--fg-faint)]">{hint}</span>}
    </div>
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
