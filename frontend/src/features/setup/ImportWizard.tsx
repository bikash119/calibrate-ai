/**
 * Dataset import wizard: file → (sheet picker for XLSX) → preview + question
 * row + column tagging → import.
 *
 * State machine:
 *   pick-file → preview-loading → ready (preview loaded, user picks)
 *   ready → committing → done | error
 *
 * The wizard sends the file twice (once to /parse, once to /import). That keeps
 * the backend stateless. Files in this codebase's OSS limit (10MB) make the
 * extra round trip acceptable.
 */

import { useMemo, useState } from "react";
import { Upload, X } from "lucide-react";

import {
  useImportDataset,
  useImportPreview,
} from "../../hooks/useDataset";
import type {
  ColumnMapping,
  ColumnRole,
  ImportPreviewResponse,
} from "../../schemas";

interface Props {
  projectId: number;
  onClose: () => void;
  onComplete: (summary: { questions_created: number; applications_created: number }) => void;
}

const ROLE_OPTIONS: { value: ColumnRole; label: string; hint: string }[] = [
  { value: "id", label: "ID", hint: "Application identifier (required, exactly one)" },
  { value: "question", label: "Question", hint: "Scoring substrate — fed to the LLM" },
  { value: "demographic", label: "Demographic", hint: "Stored; can be opted into scoring per criterion" },
  { value: "metadata", label: "Metadata", hint: "Stored; can be opted into scoring per criterion" },
  { value: "exclude", label: "Exclude", hint: "Skip this column entirely" },
];

const ROLE_PILL: Record<ColumnRole, string> = {
  id: "pill-info",
  question: "pill-green",
  demographic: "pill-yellow",
  metadata: "pill-yellow",
  exclude: "",
};

export function ImportWizard({ projectId, onClose, onComplete }: Props) {
  const preview = useImportPreview(projectId);
  const importMut = useImportDataset(projectId);

  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [questionRow, setQuestionRow] = useState<number>(0);
  const [columnRoles, setColumnRoles] = useState<Record<number, ColumnRole>>({});

  const handleFile = async (f: File) => {
    setFile(f);
    setColumnRoles({});
    setQuestionRow(0);
    try {
      const r = await preview.mutateAsync(f);
      setPreviewData(r);
      setActiveSheet(r.suggested_sheet);
    } catch {
      // surfaced via preview.error below
    }
  };

  // For the active sheet, infer columns count from the preview rows
  const numColumns = useMemo(() => {
    if (!previewData) return 0;
    return previewData.preview.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }, [previewData]);

  const setRole = (col: number, role: ColumnRole) =>
    setColumnRoles((r) => ({ ...r, [col]: role }));

  const idColumns = Object.entries(columnRoles)
    .filter(([, r]) => r === "id")
    .map(([k]) => Number(k));
  const questionLikeCount = Object.values(columnRoles).filter(
    (r) => r === "question" || r === "demographic" || r === "metadata",
  ).length;
  const canSubmit =
    !!previewData &&
    !!file &&
    idColumns.length === 1 &&
    questionLikeCount > 0 &&
    !importMut.isPending;

  const submit = async () => {
    if (!file || !previewData) return;
    const mappings: ColumnMapping[] = Array.from({ length: numColumns }, (_, i) => ({
      column_index: i,
      role: columnRoles[i] ?? "exclude",
    }));
    try {
      const result = await importMut.mutateAsync({
        file,
        mappings: {
          sheet_name: previewData.format === "xlsx" ? activeSheet : null,
          question_row_index: questionRow,
          data_start_row_index: questionRow + 1,
          column_mappings: mappings,
        },
      });
      onComplete(result);
    } catch {
      // surfaced via importMut.error below
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-5xl bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-lg max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Import dataset</h3>
            <p className="text-xs text-[var(--fg-muted)] mt-0.5">
              Upload CSV or Excel. Pick which row holds the questions, then tag each column.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={importMut.isPending}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-5 py-4 grid gap-4 overflow-y-auto">
          {/* Step 1: file picker */}
          <FilePickerSection
            file={file}
            onPick={handleFile}
            loading={preview.isPending}
            error={preview.error?.message ?? null}
          />

          {/* Step 2: sheet picker (XLSX only with multiple sheets) */}
          {previewData && previewData.format === "xlsx" && previewData.sheets.length > 1 && (
            <SheetPickerSection
              sheets={previewData.sheets}
              active={activeSheet}
              onChange={async (name) => {
                setActiveSheet(name);
                // Re-parse to get this sheet's preview rows
                if (file) {
                  const r = await preview.mutateAsync(file);
                  // Note: backend defaults preview to first sheet; for true
                  // per-sheet preview we'd need a sheet param on /parse.
                  // For now we use the first-sheet preview to drive column
                  // mapping; submit uses the chosen sheet name.
                  setPreviewData(r);
                }
              }}
            />
          )}

          {/* Step 3: preview + row picker + column tagging */}
          {previewData && (
            <PreviewSection
              preview={previewData}
              questionRow={questionRow}
              onPickQuestionRow={setQuestionRow}
              columnRoles={columnRoles}
              onSetRole={setRole}
              numColumns={numColumns}
            />
          )}

          {/* Validation hints */}
          {previewData && (
            <div className="text-xs text-[var(--fg-muted)] grid gap-0.5">
              <ChecklistRow ok={idColumns.length === 1}>
                Exactly one column tagged <strong>ID</strong>
                {idColumns.length === 0 && " (none yet)"}
                {idColumns.length > 1 && ` (${idColumns.length} tagged)`}
              </ChecklistRow>
              <ChecklistRow ok={questionLikeCount > 0}>
                At least one column tagged <strong>Question</strong>, <strong>Demographic</strong>, or <strong>Metadata</strong>
              </ChecklistRow>
            </div>
          )}

          {importMut.error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {importMut.error.message}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={importMut.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={submit}
            title={!canSubmit ? "Tag exactly one ID column and at least one data column first" : ""}
          >
            <Upload className="w-3.5 h-3.5" />
            {importMut.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Sub-sections                                                       //
// ------------------------------------------------------------------ //

function FilePickerSection({
  file,
  onPick,
  loading,
  error,
}: {
  file: File | null;
  onPick: (f: File) => void;
  loading: boolean;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium text-[var(--fg-muted)]">
        File <span className="text-[var(--fg-faint)]">(CSV or .xlsx, max 10 MB)</span>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        className={`px-4 py-6 rounded-[var(--radius-sm)] border-2 border-dashed text-center text-sm transition-colors ${
          dragging
            ? "border-[var(--accent)] bg-[var(--accent-bg)]"
            : "border-[var(--border)] bg-[var(--bg-sunken)]"
        }`}
      >
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
          />
          {file ? (
            <span className="text-[var(--fg)]">
              {file.name}{" "}
              <span className="text-[var(--fg-faint)]">— pick another to replace</span>
            </span>
          ) : (
            <span className="text-[var(--fg-muted)]">
              Drop a file here or <span className="text-[var(--accent)] underline">browse</span>
            </span>
          )}
        </label>
        {loading && <div className="text-xs text-[var(--fg-muted)] mt-2">Parsing…</div>}
      </div>
      {error && (
        <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {error}
        </div>
      )}
    </div>
  );
}

function SheetPickerSection({
  sheets,
  active,
  onChange,
}: {
  sheets: { name: string; rows: number; columns: number }[];
  active: string | null;
  onChange: (name: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium text-[var(--fg-muted)]">Sheet</div>
      <select
        value={active ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm"
      >
        {sheets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name} ({s.rows} rows × {s.columns} cols)
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewSection({
  preview,
  questionRow,
  onPickQuestionRow,
  columnRoles,
  onSetRole,
  numColumns,
}: {
  preview: ImportPreviewResponse;
  questionRow: number;
  onPickQuestionRow: (i: number) => void;
  columnRoles: Record<number, ColumnRole>;
  onSetRole: (col: number, role: ColumnRole) => void;
  numColumns: number;
}) {
  const rows = preview.preview.rows;

  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-[var(--fg-muted)]">
        Preview — first {rows.length} of {preview.preview.total_rows} rows
        <span className="text-[var(--fg-faint)] ml-2">
          Click a row's radio to mark it as the question row.
        </span>
      </div>
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="bg-[var(--bg-sunken)]">
              <th className="px-2 py-1.5 text-left font-medium text-[var(--fg-muted)] sticky left-0 bg-[var(--bg-sunken)]">
                Q?
              </th>
              <th className="px-2 py-1.5 text-left font-medium text-[var(--fg-muted)]">#</th>
              {Array.from({ length: numColumns }, (_, c) => (
                <th key={c} className="px-2 py-1.5 text-left font-medium align-top min-w-[10rem]">
                  <div className="text-[var(--fg-muted)] mb-1">col {c + 1}</div>
                  <select
                    value={columnRoles[c] ?? ""}
                    onChange={(e) => onSetRole(c, e.target.value as ColumnRole)}
                    className="w-full px-1.5 py-1 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-xs"
                  >
                    <option value="">— role —</option>
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} title={opt.hint}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {columnRoles[c] && (
                    <div className="mt-1">
                      <span className={`pill ${ROLE_PILL[columnRoles[c]]}`}>{columnRoles[c]}</span>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isQuestionRow = i === questionRow;
              return (
                <tr
                  key={i}
                  className={`border-t border-[var(--border)] ${
                    isQuestionRow ? "bg-[var(--accent-bg)]" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 sticky left-0 bg-inherit">
                    <input
                      type="radio"
                      name="questionRow"
                      checked={isQuestionRow}
                      onChange={() => onPickQuestionRow(i)}
                      title="Mark this as the row containing question text"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-[var(--fg-faint)]">{i + 1}</td>
                  {Array.from({ length: numColumns }, (_, c) => (
                    <td
                      key={c}
                      className={`px-2 py-1.5 align-top whitespace-pre-wrap ${
                        columnRoles[c] === "exclude" ? "text-[var(--fg-faint)] italic" : ""
                      }`}
                      title={row[c] ?? ""}
                    >
                      {truncate(row[c])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChecklistRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={ok ? "text-[var(--green)]" : "text-[var(--fg-faint)]"}>
        {ok ? "✓" : "○"}
      </span>
      <span className={ok ? "" : "text-[var(--fg-faint)]"}>{children}</span>
    </div>
  );
}

function truncate(s: string | null | undefined, max = 80): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
