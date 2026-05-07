/**
 * Column-mapping modal — the second stage of dataset import.
 *
 * Pattern lifted from earlier work in act_codebase: ONE ROW PER COLUMN, with
 * a sample value visible alongside the role selector. Far easier to scan than
 * stuffing role pickers into the headers of a horizontally-scrolling preview
 * table. The first stage (file upload + parse) lives in DatasetCard; this
 * modal opens when a parse succeeds.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Shield, X } from "lucide-react";

import { Banner } from "../../components/ui/Banner";
import { Modal } from "../../components/ui/Modal";
import {
  TrafficLight,
  type TrafficStatus,
} from "../../components/ui/TrafficLight";
import type {
  ColumnMapping,
  ColumnRole,
  ImportPreviewResponse,
} from "../../schemas";

interface Props {
  open: boolean;
  preview: ImportPreviewResponse;
  /** XLSX with multiple sheets: which sheet's preview is displayed. */
  activeSheet: string | null;
  onChangeSheet: (sheetName: string) => void;
  onCancel: () => void;
  onConfirm: (args: {
    sheet_name: string | null;
    question_row_index: number;
    column_mappings: ColumnMapping[];
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

const ROLES: { value: ColumnRole; label: string; hint: string }[] = [
  { value: "id", label: "Application ID", hint: "Required, exactly one" },
  { value: "question", label: "Question (LLM scoring substrate)", hint: "Will be passed to the LLM" },
  { value: "demographic", label: "Demographic (excluded from LLM)", hint: "Held aside; can be opted in per criterion later" },
  { value: "metadata", label: "Metadata (excluded from LLM)", hint: "Held aside; can be opted in per criterion later" },
  { value: "exclude", label: "Exclude entirely", hint: "Skip this column" },
];

const ID_HEADER_RX = /^\s*(id|uuid|app[-_]?id|external[-_]?id|application[-_]?id)\s*$/i;
const DEMOGRAPHIC_HINT_RX = /^\s*(age|gender|sex|ethnicity|race|nationality|location|city|state|country|pincode|zip|postal|language)\s*$/i;

export function ColumnMappingModal({
  open,
  preview,
  activeSheet,
  onChangeSheet,
  onCancel,
  onConfirm,
  submitting,
  error,
}: Props) {
  const numColumns = useMemo(
    () => preview.preview.rows.reduce((m, r) => Math.max(m, r.length), 0),
    [preview],
  );

  // Default: first row is the question row (most CSVs work this way).
  const [questionRow, setQuestionRow] = useState(0);

  // Per-column role with smart defaults. Recomputed when the question row
  // changes, since the suggestion is keyed off the headers in that row.
  const [roles, setRoles] = useState<Record<number, ColumnRole>>(() =>
    suggestRoles(preview, 0, numColumns),
  );

  // Recompute defaults when the question row changes (only for columns the
  // user hasn't explicitly set yet — keep their picks sticky).
  useEffect(() => {
    setRoles((prev) => {
      const fresh = suggestRoles(preview, questionRow, numColumns);
      const merged: Record<number, ColumnRole> = { ...fresh };
      // Preserve any user-set role that disagrees with the fresh suggestion
      for (const [idxStr, role] of Object.entries(prev)) {
        merged[Number(idxStr)] = role;
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionRow, preview]);

  const headers = preview.preview.rows[questionRow] ?? [];
  const sample = preview.preview.rows[questionRow + 1] ?? preview.preview.rows[1] ?? [];

  const counts = countRoles(roles, numColumns);
  const idCount = counts.id ?? 0;
  const questionCount = counts.question ?? 0;
  const demoCount = counts.demographic ?? 0;
  const metaCount = counts.metadata ?? 0;
  const valid = idCount === 1 && questionCount + demoCount + metaCount > 0;

  const setRole = (col: number, role: ColumnRole) =>
    setRoles((r) => ({ ...r, [col]: role }));

  const submit = async () => {
    const mappings: ColumnMapping[] = Array.from({ length: numColumns }, (_, i) => ({
      column_index: i,
      role: roles[i] ?? "exclude",
    }));
    await onConfirm({
      sheet_name: preview.format === "xlsx" ? activeSheet : null,
      question_row_index: questionRow,
      column_mappings: mappings,
    });
  };

  return (
    <Modal open={open} onClose={onCancel} width={1000}>
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Map columns</h3>
          <p className="text-xs text-[var(--fg-muted)] mt-0.5">
            Confirm what each column is. <strong>Demographic</strong> columns are
            <strong> not passed to the LLM</strong> — they're held aside for silent
            bias-audit computation only. <strong>Metadata</strong> is also excluded
            by default; you can opt either into a criterion's feeding fields later.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={submitting}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-5 py-4 grid gap-3 max-h-[70vh] overflow-y-auto">
        {/* Sheet picker (XLSX with multiple sheets) */}
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
          </Field>
        )}

        {/* Question row picker */}
        <Field
          label="Question row"
          hint="The row containing question text (column headers). Defaults to the first row; bump up if your file has category rows above the actual headers."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={preview.preview.rows.length - 1}
              value={questionRow}
              onChange={(e) =>
                setQuestionRow(
                  Math.max(
                    0,
                    Math.min(
                      preview.preview.rows.length - 1,
                      Number(e.target.value) || 0,
                    ),
                  ),
                )
              }
              className="w-20 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm [font-variant-numeric:tabular-nums]"
            />
            <span className="text-xs text-[var(--fg-faint)]">
              0-indexed (row {questionRow + 1} in the spreadsheet)
            </span>
          </div>
        </Field>

        {/* Validation pills */}
        <div className="flex flex-wrap gap-2 text-xs">
          <ValidationPill ok={idCount === 1} label={`ID column · ${idCount}/1`} />
          <ValidationPill
            ok={questionCount + demoCount + metaCount > 0}
            label={`Mapped columns · ${questionCount + demoCount + metaCount}`}
          />
          {demoCount > 0 && (
            <span className="pill text-xs flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> Demographic · {demoCount}
            </span>
          )}
          {metaCount > 0 && (
            <span className="pill text-xs">Metadata · {metaCount}</span>
          )}
        </div>

        {/* Column mapping table */}
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)] overflow-x-auto max-h-96">
          <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
            <thead className="bg-[var(--bg-sunken)] sticky top-0">
              <tr className="text-left text-[var(--fg-muted)]">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Header</th>
                <th className="px-3 py-2 font-medium">Sample</th>
                <th className="px-3 py-2 font-medium" style={{ width: 280 }}>
                  Role
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: numColumns }, (_, c) => {
                const header = headers[c] ?? "";
                const sampleVal = sample[c] ?? "";
                const role = roles[c] ?? "exclude";
                const status: TrafficStatus =
                  role === "exclude" ? "gray" : role === "id" ? "yellow" : "green";
                return (
                  <tr key={c} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 text-[var(--fg-faint)]">{c + 1}</td>
                    <td className="px-3 py-2 font-mono">
                      <div className="flex items-center gap-1.5">
                        <TrafficLight status={status} />
                        <span className="truncate max-w-xs">{header || <em className="text-[var(--fg-faint)]">(empty)</em>}</span>
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 text-[var(--fg-muted)] truncate max-w-xs"
                      title={sampleVal ?? ""}
                    >
                      {sampleVal || <em className="text-[var(--fg-faint)]">(empty)</em>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={role}
                        onChange={(e) => setRole(c, e.target.value as ColumnRole)}
                        className="w-full px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-xs"
                      >
                        {ROLES.map((opt) => (
                          <option key={opt.value} value={opt.value} title={opt.hint}>
                            {opt.label}
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

        <Banner kind="info" title="Bias-audit columns are isolated">
          Roles tagged "Demographic" are stripped from the prompt context.
          The platform may compute aggregate score statistics across them
          after scoring but never shows individual group scores during
          iteration. Metadata fields follow the same exclusion rule.
        </Banner>

        {error && (
          <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
            {error}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
        <button className="btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={!valid || submitting}
          title={
            !valid
              ? "Tag exactly one ID column and at least one Question/Demographic/Metadata column"
              : ""
          }
        >
          {submitting ? "Importing…" : "Confirm mapping"}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ //
// Helpers                                                            //
// ------------------------------------------------------------------ //

function suggestRoles(
  preview: ImportPreviewResponse,
  questionRowIdx: number,
  numColumns: number,
): Record<number, ColumnRole> {
  const headerRow = preview.preview.rows[questionRowIdx] ?? [];
  const out: Record<number, ColumnRole> = {};
  let idAssigned = false;

  for (let c = 0; c < numColumns; c++) {
    const header = (headerRow[c] ?? "").trim();
    if (!idAssigned && header && ID_HEADER_RX.test(header)) {
      out[c] = "id";
      idAssigned = true;
      continue;
    }
    if (header && DEMOGRAPHIC_HINT_RX.test(header)) {
      out[c] = "demographic";
      continue;
    }
    if (!header) {
      out[c] = "exclude";
      continue;
    }
    out[c] = "question";
  }

  return out;
}

function countRoles(
  roles: Record<number, ColumnRole>,
  numColumns: number,
): Record<ColumnRole, number> {
  const counts = { id: 0, question: 0, demographic: 0, metadata: 0, exclude: 0 } as Record<
    ColumnRole,
    number
  >;
  for (let c = 0; c < numColumns; c++) {
    const r = roles[c] ?? "exclude";
    counts[r] += 1;
  }
  return counts;
}

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

function ValidationPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`pill text-xs ${ok ? "pill-green" : "pill-red"}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <TrafficLight status={ok ? "green" : "red"} />
      {label}
    </span>
  );
}
