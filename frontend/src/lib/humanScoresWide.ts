/**
 * Wide → long pivot for human-scores uploads.
 *
 * Real-world human-score sheets almost always arrive in *wide* form:
 *
 *   external_id, alice_team, bob_team, alice_market, bob_market, …
 *   app-001,     4,          5,        3,            4
 *
 * Our DB and upload API both expect *long* form (one row per evaluator ×
 * application × criterion). This module:
 *
 *  1. Detects the application-id column.
 *  2. Splits each remaining column header into (evaluator, criterion) using a
 *     handful of common separators, checking detected criterion names against
 *     the project rubric so we pick the right split.
 *  3. Returns a typed mapping the UI can display, plus the long-form rows
 *     ready to POST.
 *
 * Pure functions only — no React, no fetch. The wizard component owns UI.
 */

export type ScoreLayout = "wide" | "long";

/** Wide-upload layout. Two real-world shapes:
 *  - 'per-column': each column header is `evaluator_criterion` (one file holds
 *    every evaluator's scores). Auto-detected when ≥1 column splits cleanly.
 *  - 'per-file': the whole file is one evaluator's scores; each column is a
 *    criterion. Auto-detected when 0 columns split cleanly. */
export type ScoreUploadLayout = "per-column" | "per-file";

export interface LongRow {
  external_id: string;
  criterion_name: string;
  evaluator_id: string;
  score: number;
}

/** Separator candidates we try, in priority order. Longer ones first so
 *  `__` wins over `_` when both match. */
const SEPARATORS = ["__", " - ", "::", ".", "_", "-"] as const;

/** Header names we recognize as the application id column. */
const ID_HEADER_PATTERNS = [
  "external_id",
  "external id",
  "id",
  "application_id",
  "applicant_id",
  "app_id",
  "applicant",
];

export interface ColumnMapping {
  /** Original column header verbatim. */
  header: string;
  /** Evaluator name (per-column layout only — ignored in per-file mode). */
  evaluator: string | null;
  /** Criterion name matched against project rubric (or set by override). */
  criterion: string | null;
  /** Which separator we used (for explainability). null = no split tried. */
  separator: string | null;
  /** True when the criterion name matches a project criterion exactly
   *  (case-insensitive). False = needs operator review. */
  criterionMatched: boolean;
  /** When true, this column is dropped during the pivot — used for
   *  totals, demographics, names, etc. that aren't score columns. */
  excluded: boolean;
}

export interface PivotPlan {
  /** Detected application id column header. null = couldn't infer; user picks. */
  idColumn: string | null;
  /** All non-id columns with their detected evaluator/criterion. */
  columns: ColumnMapping[];
  /** Headers we couldn't make sense of (user must drop or rename). */
  unmappedHeaders: string[];
  /** Which mental model applies to this upload. */
  layout: ScoreUploadLayout;
  /** Used in per-file layout: the single evaluator-id this file represents.
   *  Null = operator hasn't named it yet (per-file plans are not ready). */
  fileEvaluator: string | null;
}

/**
 * Build the initial pivot plan from CSV headers + the project's criterion
 * names. The caller mutates it via `overrideMapping` / `setLayout` /
 * `setFileEvaluator` before pivoting.
 *
 * What this DOES auto-detect:
 *   - ID column (matches common id-header aliases).
 *   - Layout — per-column vs per-file, based on whether any column header
 *     splits on a known separator.
 *   - Evaluator name in per-column mode (left side of the split).
 *
 * What this does NOT auto-detect:
 *   - Criterion mapping. Every column starts with `criterion: null`. Operator
 *     picks from the dropdown. Auto-criterion-matching has been removed
 *     because real-world column headers (paraphrased questions, mixed
 *     languages) caused too many wrong-but-confident matches.
 *
 * `criteriaNames` is still passed in so `overrideMapping` can flag a manual
 * pick as `criterionMatched: true`.
 */
export function detectLayout(
  headers: string[],
  criteriaNames: string[],
): PivotPlan {
  const lower = headers.map((h) => h.toLowerCase().trim());

  // ---- ID column ----
  let idColumn: string | null = null;
  for (const pat of ID_HEADER_PATTERNS) {
    const idx = lower.indexOf(pat);
    if (idx >= 0) {
      idColumn = headers[idx];
      break;
    }
  }

  // ---- Score columns: try a separator-based split for evaluator extraction.
  // Criterion is left null — operator picks. ----
  const columns: ColumnMapping[] = [];
  const unmappedHeaders: string[] = [];
  for (const header of headers) {
    if (header === idColumn) continue;
    const trimmed = header.trim();
    if (!trimmed) {
      unmappedHeaders.push(header);
      continue;
    }
    const split = splitOnSeparator(trimmed);
    columns.push({
      header,
      evaluator: split?.evaluator ?? null,
      criterion: null,
      separator: split?.separator ?? null,
      criterionMatched: false,
      excluded: false,
    });
  }
  // Mention `criteriaNames` so the unused-argument lint stays quiet — the
  // value is consumed by overrideMapping, not detectLayout.
  void criteriaNames;

  // Layout choice: any column splitting on a known separator → per-column.
  // Otherwise the file is treated as one evaluator's scores.
  const anySplit = columns.some((c) => c.separator !== null);
  const layout: ScoreUploadLayout = anySplit ? "per-column" : "per-file";

  return { idColumn, columns, unmappedHeaders, layout, fileEvaluator: null };
}

/** Split a header on the first matching separator (longest first). Convention:
 *  the part before the separator is the evaluator id. Returns null if no
 *  separator is found. */
function splitOnSeparator(
  header: string,
): { evaluator: string; separator: string } | null {
  for (const sep of SEPARATORS) {
    const idx = header.indexOf(sep);
    if (idx < 0) continue;
    const left = header.slice(0, idx).trim();
    const right = header.slice(idx + sep.length).trim();
    if (!left || !right) continue;
    return { evaluator: left, separator: sep };
  }
  return null;
}

/** Apply user overrides to a column mapping. Returns a new plan. */
export function overrideMapping(
  plan: PivotPlan,
  header: string,
  patch: {
    evaluator?: string | null;
    criterion?: string | null;
    excluded?: boolean;
  },
  criteriaNames: string[],
): PivotPlan {
  const critLower = new Set(criteriaNames.map((c) => c.toLowerCase()));
  return {
    ...plan,
    columns: plan.columns.map((c) => {
      if (c.header !== header) return c;
      const next = { ...c };
      if (patch.evaluator !== undefined) next.evaluator = patch.evaluator;
      if (patch.criterion !== undefined) {
        next.criterion = patch.criterion;
        next.criterionMatched =
          patch.criterion != null &&
          critLower.has(patch.criterion.toLowerCase());
      }
      if (patch.excluded !== undefined) next.excluded = patch.excluded;
      return next;
    }),
  };
}

/** Override the id column. */
export function setIdColumn(plan: PivotPlan, header: string | null): PivotPlan {
  return { ...plan, idColumn: header };
}

/** Switch between per-column and per-file layouts. Per-column data and
 *  per-file data are preserved across the switch — the `layout` flag just
 *  controls which fields are treated as authoritative downstream. */
export function setLayout(plan: PivotPlan, layout: ScoreUploadLayout): PivotPlan {
  return { ...plan, layout };
}

/** Set the single evaluator id for a per-file upload. */
export function setFileEvaluator(
  plan: PivotPlan,
  evaluator: string | null,
): PivotPlan {
  return { ...plan, fileEvaluator: evaluator };
}

export interface PivotIssue {
  kind: "missing_id_column" | "invalid_score" | "missing_criterion";
  header?: string;
  external_id?: string;
  message: string;
}

export interface PivotResult {
  layout: ScoreLayout;
  rows: LongRow[];
  issues: PivotIssue[];
  /** evaluator → criterion → count (apps scored). */
  coverage: CoverageMap;
  evaluators: string[];
  criteria: string[];
}

export type CoverageMap = Map<string, Map<string, number>>;

/**
 * Pivot CSV rows from wide to long using a finalized plan. Skips empty cells
 * and excluded columns. Reports issues (bad scores) without throwing — the
 * caller surfaces them so the operator can fix the spreadsheet and try again.
 *
 * In `per-file` layout, `plan.fileEvaluator` is used as the evaluator id for
 * every emitted row; per-column `evaluator` fields are ignored.
 */
export function pivotRows(
  plan: PivotPlan,
  rows: Record<string, string>[],
): PivotResult {
  const issues: PivotIssue[] = [];
  if (!plan.idColumn) {
    return {
      layout: "wide",
      rows: [],
      issues: [
        {
          kind: "missing_id_column",
          message: "No application id column selected.",
        },
      ],
      coverage: new Map(),
      evaluators: [],
      criteria: [],
    };
  }
  if (plan.layout === "per-file" && !plan.fileEvaluator) {
    return {
      layout: "wide",
      rows: [],
      issues: [
        {
          kind: "missing_criterion",
          message: "No evaluator id provided for this file.",
        },
      ],
      coverage: new Map(),
      evaluators: [],
      criteria: [],
    };
  }

  const coverage: CoverageMap = new Map();
  const evaluators = new Set<string>();
  const criteria = new Set<string>();
  const out: LongRow[] = [];

  for (const row of rows) {
    const externalId = (row[plan.idColumn] ?? "").trim();
    if (!externalId) continue;

    for (const col of plan.columns) {
      if (col.excluded) continue;
      const evaluatorId =
        plan.layout === "per-file" ? plan.fileEvaluator : col.evaluator;
      if (!evaluatorId || !col.criterion) {
        // Silently skip unmapped columns — already surfaced by isPlanReady().
        continue;
      }
      const raw = (row[col.header] ?? "").trim();
      if (!raw) continue;
      const score = Number(raw);
      if (!Number.isFinite(score) || !Number.isInteger(score)) {
        issues.push({
          kind: "invalid_score",
          header: col.header,
          external_id: externalId,
          message: `Score for ${externalId} / ${col.header} is not an integer: '${raw}'`,
        });
        continue;
      }
      out.push({
        external_id: externalId,
        criterion_name: col.criterion,
        evaluator_id: evaluatorId,
        score,
      });
      evaluators.add(evaluatorId);
      criteria.add(col.criterion);
      const inner = coverage.get(evaluatorId) ?? new Map();
      inner.set(col.criterion, (inner.get(col.criterion) ?? 0) + 1);
      coverage.set(evaluatorId, inner);
    }
  }

  return {
    layout: "wide",
    rows: out,
    issues,
    coverage,
    evaluators: [...evaluators].sort(),
    criteria: [...criteria].sort(),
  };
}

/** True when the plan can produce a valid pivot. Excluded columns are
 *  ignored. In per-file layout, fileEvaluator must be non-empty. */
export function isPlanReady(plan: PivotPlan): boolean {
  if (!plan.idColumn) return false;
  if (plan.layout === "per-file" && !plan.fileEvaluator?.trim()) return false;
  // Need at least one non-excluded, fully-mapped score column.
  let any = false;
  for (const c of plan.columns) {
    if (c.excluded) continue;
    if (!c.criterion) return false;
    if (plan.layout === "per-column" && !c.evaluator) return false;
    any = true;
  }
  return any;
}

/**
 * Return the first column that is not yet ready, so the UI can highlight it
 * and scroll to the right row. null = plan is ready.
 */
export function firstUnmappedColumn(plan: PivotPlan): string | null {
  for (const c of plan.columns) {
    if (c.excluded) continue;
    if (!c.criterion) return c.header;
    if (plan.layout === "per-column" && !c.evaluator) return c.header;
  }
  return null;
}

/**
 * Slice a 2D grid (from `/parse`) into headers + record rows, given the
 * operator-chosen header row + data start row. Empty header cells are
 * given a `col_N` placeholder so the column still has a stable key for
 * the pivot layer. Blank data rows (every cell empty) are dropped.
 *
 * Used by the wide-upload wizard once the operator confirms which row
 * holds the headers.
 */
export function sliceGridForPivot(
  grid: (string | null)[][],
  headerRowIndex: number,
  dataStartIndex: number,
): { headers: string[]; rows: Record<string, string>[] } {
  const headerRow = grid[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, i) => {
    const trimmed = (cell ?? "").trim();
    return trimmed || `col_${i + 1}`;
  });

  const rows: Record<string, string>[] = [];
  for (let i = dataStartIndex; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => {
      const v = row[j];
      obj[h] = v == null ? "" : v.trim();
    });
    if (Object.values(obj).some((v) => v.length > 0)) rows.push(obj);
  }
  return { headers, rows };
}
