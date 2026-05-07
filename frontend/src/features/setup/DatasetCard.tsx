/**
 * Dataset on the setup page — three states.
 *
 *   empty:          Drop a CSV/XLSX to start
 *   needs_mapping:  File parsed; prompt the operator to confirm column roles
 *   confirmed:      Questions + applications loaded; show summary + re-import
 *
 * Stage 1 (upload) is inline. Stage 2 (column tagging) opens
 * `ColumnMappingModal` — a column-row table that's far more scannable than
 * stuffing role pickers into a preview's column headers.
 */

import { useState } from "react";
import { Pencil, RefreshCw, Upload } from "lucide-react";

import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import {
  useApplications,
  useImportDataset,
  useImportPreview,
  useQuestions,
} from "../../hooks/useDataset";
import { ColumnMappingModal } from "./ColumnMappingModal";
import type {
  ColumnMapping,
  ImportPreviewResponse,
  QuestionType,
} from "../../schemas";

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
  const previewMut = useImportPreview(projectId);
  const importMut = useImportDataset(projectId);

  // Pending upload state — set after parse succeeds, cleared after import.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<ImportPreviewResponse | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const hasData =
    (questions.data?.questions.length ?? 0) > 0 ||
    (apps.data?.applications.length ?? 0) > 0;
  const inMappingState = pendingFile !== null && pendingPreview !== null;

  const handleFile = async (file: File) => {
    setPendingFile(file);
    importMut.reset();
    try {
      const r = await previewMut.mutateAsync(file);
      setPendingPreview(r);
      setActiveSheet(r.suggested_sheet);
      setModalOpen(true);
    } catch {
      // surfaced via previewMut.error below
      setPendingFile(null);
    }
  };

  const handleConfirm = async (args: {
    sheet_name: string | null;
    question_row_index: number;
    column_mappings: ColumnMapping[];
  }) => {
    if (!pendingFile) return;
    await importMut.mutateAsync({
      file: pendingFile,
      mappings: {
        sheet_name: args.sheet_name,
        question_row_index: args.question_row_index,
        data_start_row_index: args.question_row_index + 1,
        column_mappings: args.column_mappings,
      },
    });
    setPendingFile(null);
    setPendingPreview(null);
    setModalOpen(false);
  };

  const discardPending = () => {
    setPendingFile(null);
    setPendingPreview(null);
    setActiveSheet(null);
    setModalOpen(false);
    previewMut.reset();
    importMut.reset();
  };

  // ----- Render --------------------------------------------------- //

  // The mapping modal can be open or closed; the card body renders the state.
  return (
    <>
      <Card
        title="Dataset"
        desc="Questions + applications + (optional) demographic / metadata columns. Upload one CSV or Excel; tag the columns; the rest is automatic."
        action={
          !disabled && hasData && !inMappingState ? (
            <button
              className="btn btn-sm"
              onClick={() => document.getElementById("dataset-file-input")?.click()}
              disabled={previewMut.isPending}
            >
              <RefreshCw className="w-3 h-3" /> Re-import
            </button>
          ) : null
        }
      >
        {/* Always-present hidden file input, triggered by the upload zone or the Re-import button */}
        <input
          id="dataset-file-input"
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {/* needs_mapping banner — file parsed, awaiting confirmation */}
        {inMappingState && (
          <Banner
            kind="warn"
            title="Column mapping required"
            action={
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={discardPending}>
                  Discard
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setModalOpen(true)}
                >
                  Map columns
                </button>
              </div>
            }
          >
            Parsed <strong>{pendingFile!.name}</strong>. Confirm which columns are
            the ID, the questions, and (optionally) demographic / metadata before
            we create questions + applications.
          </Banner>
        )}

        {/* empty state */}
        {!inMappingState && !hasData && !disabled && (
          <UploadDropZone
            onPick={handleFile}
            loading={previewMut.isPending}
            error={previewMut.error?.message ?? null}
          />
        )}

        {/* confirmed state — show summary */}
        {!inMappingState && hasData && (
          <DatasetSummary
            questions={questions.data?.questions ?? []}
            applicationCount={apps.data?.applications.length ?? 0}
            scoredCount={
              apps.data?.applications.filter((a) => a.has_human_scores).length ?? 0
            }
          />
        )}

        {/* read-only past setup */}
        {!inMappingState && !hasData && disabled && (
          <div className="text-sm text-[var(--fg-muted)]">
            Project is past setup. No dataset was imported.
          </div>
        )}
      </Card>

      {pendingPreview && (
        <ColumnMappingModal
          open={modalOpen}
          preview={pendingPreview}
          activeSheet={activeSheet}
          onChangeSheet={setActiveSheet}
          onCancel={() => setModalOpen(false)}
          onConfirm={handleConfirm}
          submitting={importMut.isPending}
          error={importMut.error?.message ?? null}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ //
// Empty-state upload zone                                            //
// ------------------------------------------------------------------ //

function UploadDropZone({
  onPick,
  loading,
  error,
}: {
  onPick: (file: File) => void;
  loading: boolean;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  return (
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
      className={`px-4 py-8 rounded-[var(--radius-sm)] border-2 border-dashed text-center transition-colors ${
        dragging
          ? "border-[var(--accent)] bg-[var(--accent-bg)]"
          : "border-[var(--border)] bg-[var(--bg-sunken)]"
      }`}
    >
      <Upload className="w-5 h-5 text-[var(--fg-faint)] mx-auto mb-2" />
      <div className="text-sm font-medium mb-1">
        Drop a CSV or Excel file here
      </div>
      <div className="text-xs text-[var(--fg-muted)] mb-3">
        Up to 10 MB · 5,000 rows · 100 columns
      </div>
      <label className="btn btn-primary btn-sm inline-flex">
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
        Choose file
      </label>
      {loading && (
        <div className="text-xs text-[var(--fg-muted)] mt-3">Parsing…</div>
      )}
      {error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {error}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //
// Confirmed-state summary                                            //
// ------------------------------------------------------------------ //

function DatasetSummary({
  questions,
  applicationCount,
  scoredCount,
}: {
  questions: Array<{ id: number; key: string; text: string; type: QuestionType }>;
  applicationCount: number;
  scoredCount: number;
}) {
  const counts = {
    question: questions.filter((q) => q.type === "question").length,
    demographic: questions.filter((q) => q.type === "demographic").length,
    metadata: questions.filter((q) => q.type === "metadata").length,
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Applications" value={applicationCount} />
        <Stat label="Questions" value={counts.question} />
        <Stat
          label="Demographic fields"
          value={counts.demographic}
          muted={counts.demographic === 0}
        />
        <Stat
          label="Metadata fields"
          value={counts.metadata}
          muted={counts.metadata === 0}
        />
      </div>
      {applicationCount > 0 && (
        <div className="text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums]">
          {scoredCount}/{applicationCount} applications have at least one human score.
        </div>
      )}
      {questions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--fg-faint)] hover:text-[var(--fg)]">
            <Pencil className="w-3 h-3 inline mr-1" />
            Inspect columns
          </summary>
          <ul className="mt-2 grid gap-1">
            {questions.map((q) => (
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
                <span className="truncate">{q.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
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
