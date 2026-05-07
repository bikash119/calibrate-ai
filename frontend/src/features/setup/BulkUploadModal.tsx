/**
 * Bulk-upload modal. Accepts JSON paste OR CSV (paste or file upload).
 *
 * The modal handles parsing only. Per-row conversion to the upload payload
 * `T` is passed in via `parseCsvRow` — caller decides what valid data looks
 * like, throws an error on bad rows. JSON mode expects a top-level array of
 * already-shaped `T`.
 */

import { useMemo, useState } from "react";

import { CsvParseError, parseCsv, type CsvParseResult } from "../../lib/csv";

type Mode = "csv" | "json";

interface Props<T> {
  title: string;
  desc: string;
  /** Plain-text JSON shape (for the help block). */
  jsonSchemaSpec: string;
  /** Plain-text JSON example. */
  jsonExample: string;
  /** Plain-text description of expected CSV columns. */
  csvSchemaSpec: string;
  /** Plain-text CSV example. */
  csvExample: string;
  /** Convert one parsed CSV row to a payload item. Throw to reject. */
  parseCsvRow: (row: Record<string, string>, headers: string[]) => T;
  /** Show first N parsed items (read-only) before submit. */
  previewLimit?: number;
  onClose: () => void;
  onSubmit: (parsed: T[]) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

export function BulkUploadModal<T>({
  title,
  desc,
  jsonSchemaSpec,
  jsonExample,
  csvSchemaSpec,
  csvExample,
  parseCsvRow,
  previewLimit = 5,
  onClose,
  onSubmit,
  submitting,
  error,
}: Props<T>) {
  const [mode, setMode] = useState<Mode>("csv");
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const parsed = useMemo<{ items: T[]; preview: T[]; csv?: CsvParseResult } | null>(() => {
    if (!text.trim()) return null;
    try {
      if (mode === "json") {
        const items = parseJson<T>(text);
        return { items, preview: items.slice(0, previewLimit) };
      }
      const csv = parseCsv(text);
      if (csv.rows.length === 0) {
        throw new Error("CSV contains no data rows.");
      }
      const items = csv.rows.map((r) => parseCsvRow(r, csv.headers));
      return { items, preview: items.slice(0, previewLimit), csv };
    } catch {
      // Surface parse errors lazily — only when user submits — so they don't
      // flash while typing. We just return null.
      return null;
    }
  }, [text, mode, parseCsvRow, previewLimit]);

  const handleSubmit = async () => {
    setParseError(null);
    let items: T[];
    try {
      items = mode === "json" ? parseJson<T>(text) : await convertCsv(text, parseCsvRow);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (items.length === 0) {
      setParseError("Nothing to upload — the input is empty.");
      return;
    }
    await onSubmit(items);
  };

  const onFile = (file: File) => {
    void file.text().then((t) => {
      setMode("csv");
      setText(t);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // Only reset if we're truly leaving the wrapper, not entering a child
    if (e.currentTarget === e.target) setIsDragging(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-xs text-[var(--fg-muted)] mt-0.5">{desc}</p>
        </div>

        <div className="px-5 py-4 grid gap-3 overflow-y-auto">
          {/* Format tabs */}
          <div className="flex items-center gap-1 border-b border-[var(--border)] -mx-5 px-5">
            <FormatTab current={mode} value="csv" label="CSV" onSelect={setMode} />
            <FormatTab current={mode} value="json" label="JSON" onSelect={setMode} />
            {mode === "csv" && (
              <label className="ml-auto text-xs text-[var(--fg-muted)] cursor-pointer hover:text-[var(--fg)]">
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
            )}
          </div>

          {/* Schema reference */}
          <div>
            <div className="text-xs font-medium text-[var(--fg-muted)] mb-1">
              {mode === "csv" ? "Expected columns" : "Expected JSON shape"}
            </div>
            <pre className="text-xs bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 overflow-x-auto font-[var(--font-mono)]">
              {mode === "csv" ? csvSchemaSpec : jsonSchemaSpec}
            </pre>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--fg-muted)] mb-1">Example</div>
            <pre className="text-xs bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 overflow-x-auto font-[var(--font-mono)]">
              {mode === "csv" ? csvExample : jsonExample}
            </pre>
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium text-[var(--fg-muted)]">
              {mode === "csv"
                ? "Paste CSV, drop a file here, or use Choose CSV file above"
                : "Paste JSON array"}
            </span>
            <div
              onDrop={mode === "csv" ? handleDrop : undefined}
              onDragOver={mode === "csv" ? handleDragOver : undefined}
              onDragLeave={mode === "csv" ? handleDragLeave : undefined}
              className={`rounded-[var(--radius-sm)] border-2 transition-colors ${
                isDragging
                  ? "border-[var(--accent)] border-dashed bg-[var(--accent-bg)]"
                  : "border-transparent"
              }`}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-xs font-[var(--font-mono)] focus:outline-none focus:border-[var(--accent)]"
                placeholder={mode === "csv" ? "external_id,…\napp-001,…" : "[{...}, {...}]"}
                spellCheck={false}
              />
            </div>
          </div>

          {/* Preview */}
          {parsed && (
            <div className="text-xs">
              <div className="text-[var(--fg-muted)] [font-variant-numeric:tabular-nums] mb-1">
                {parsed.items.length} row{parsed.items.length === 1 ? "" : "s"} parsed
                {parsed.csv && ` from CSV (${parsed.csv.headers.length} columns)`}
                {parsed.preview.length < parsed.items.length &&
                  ` — showing first ${parsed.preview.length}`}
              </div>
              <pre className="text-xs bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 overflow-x-auto max-h-40 font-[var(--font-mono)]">
                {JSON.stringify(parsed.preview, null, 2)}
              </pre>
            </div>
          )}

          {(parseError || error) && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {parseError || error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !text.trim()}
          >
            {submitting ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //

function FormatTab({
  current,
  value,
  label,
  onSelect,
}: {
  current: Mode;
  value: Mode;
  label: string;
  onSelect: (v: Mode) => void;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onSelect(value)}
      className={`px-3 py-1.5 text-xs border-b-2 -mb-px transition-colors ${
        active
          ? "border-[var(--accent)] text-[var(--fg)]"
          : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]"
      }`}
    >
      {label}
    </button>
  );
}

function parseJson<T>(text: string): T[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(v)) throw new Error("Top-level value must be a JSON array.");
  return v as T[];
}

async function convertCsv<T>(
  text: string,
  parseCsvRow: (row: Record<string, string>, headers: string[]) => T,
): Promise<T[]> {
  let csv: CsvParseResult;
  try {
    csv = parseCsv(text);
  } catch (e) {
    if (e instanceof CsvParseError) throw e;
    throw new Error(`CSV parse failed: ${(e as Error).message}`);
  }
  if (csv.rows.length === 0) throw new Error("CSV contains no data rows.");
  const items: T[] = [];
  for (let i = 0; i < csv.rows.length; i++) {
    try {
      items.push(parseCsvRow(csv.rows[i], csv.headers));
    } catch (e) {
      throw new Error(`Row ${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return items;
}
