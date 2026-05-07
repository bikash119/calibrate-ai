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
  /** Evaluator name as auto-detected (or set by override). */
  evaluator: string | null;
  /** Criterion name matched against project rubric (or set by override). */
  criterion: string | null;
  /** Which separator we used (for explainability). null = no split tried. */
  separator: string | null;
  /** True when the criterion name matches a project criterion exactly
   *  (case-insensitive). False = needs operator review. */
  criterionMatched: boolean;
}

export interface PivotPlan {
  /** Detected application id column header. null = couldn't infer; user picks. */
  idColumn: string | null;
  /** All non-id columns with their detected evaluator/criterion. */
  columns: ColumnMapping[];
  /** Headers we couldn't make sense of (user must drop or rename). */
  unmappedHeaders: string[];
}

/**
 * Build the initial pivot plan from CSV headers + the project's criterion
 * names. The caller can then mutate the returned plan via `overrideMapping`
 * before calling `pivotRows`.
 */
export function detectLayout(
  headers: string[],
  criteriaNames: string[],
): PivotPlan {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const critLower = new Set(criteriaNames.map((c) => c.toLowerCase()));

  // ---- ID column ----
  let idColumn: string | null = null;
  for (const pat of ID_HEADER_PATTERNS) {
    const idx = lower.indexOf(pat);
    if (idx >= 0) {
      idColumn = headers[idx];
      break;
    }
  }

  // ---- Score columns ----
  const columns: ColumnMapping[] = [];
  const unmappedHeaders: string[] = [];
  for (const header of headers) {
    if (header === idColumn) continue;
    const trimmed = header.trim();
    if (!trimmed) {
      unmappedHeaders.push(header);
      continue;
    }
    const split = splitWithSeparator(trimmed, critLower);
    if (split) {
      columns.push({
        header,
        evaluator: split.evaluator,
        criterion: split.criterion,
        separator: split.separator,
        criterionMatched: split.criterionMatched,
      });
    } else {
      // No separator hit — treat the entire column name as criterion with no
      // evaluator, so the operator can fix it manually.
      columns.push({
        header,
        evaluator: null,
        criterion: critLower.has(trimmed.toLowerCase()) ? trimmed : null,
        separator: null,
        criterionMatched: critLower.has(trimmed.toLowerCase()),
      });
    }
  }

  return { idColumn, columns, unmappedHeaders };
}

/** Try each separator; prefer the split where one side matches a project criterion. */
function splitWithSeparator(
  header: string,
  knownCriteria: Set<string>,
): {
  evaluator: string;
  criterion: string;
  separator: string;
  criterionMatched: boolean;
} | null {
  let fallback: {
    evaluator: string;
    criterion: string;
    separator: string;
    criterionMatched: boolean;
  } | null = null;

  for (const sep of SEPARATORS) {
    const idx = header.indexOf(sep);
    if (idx < 0) continue;
    const left = header.slice(0, idx).trim();
    const right = header.slice(idx + sep.length).trim();
    if (!left || !right) continue;

    const leftMatches = knownCriteria.has(left.toLowerCase());
    const rightMatches = knownCriteria.has(right.toLowerCase());

    if (rightMatches) {
      // evaluator_criterion pattern (most common, e.g. alice_team)
      return {
        evaluator: left,
        criterion: right,
        separator: sep,
        criterionMatched: true,
      };
    }
    if (leftMatches) {
      // criterion_evaluator pattern (e.g. team_alice)
      return {
        evaluator: right,
        criterion: left,
        separator: sep,
        criterionMatched: true,
      };
    }
    // Stash the first-found split as the unmatched fallback.
    if (!fallback) {
      fallback = {
        evaluator: left,
        criterion: right,
        separator: sep,
        criterionMatched: false,
      };
    }
  }
  return fallback;
}

/** Apply user overrides to a column mapping. Returns a new plan. */
export function overrideMapping(
  plan: PivotPlan,
  header: string,
  patch: { evaluator?: string | null; criterion?: string | null },
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
      return next;
    }),
  };
}

/** Override the id column. */
export function setIdColumn(plan: PivotPlan, header: string | null): PivotPlan {
  return { ...plan, idColumn: header };
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
 * Pivot CSV rows from wide to long using a finalized plan. Skips empty cells.
 * Reports issues (bad scores, unmapped columns) without throwing — the caller
 * surfaces them so the operator can fix the spreadsheet and try again.
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

  const coverage: CoverageMap = new Map();
  const evaluators = new Set<string>();
  const criteria = new Set<string>();
  const out: LongRow[] = [];

  for (const row of rows) {
    const externalId = (row[plan.idColumn] ?? "").trim();
    if (!externalId) continue;

    for (const col of plan.columns) {
      if (!col.evaluator || !col.criterion) {
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
        evaluator_id: col.evaluator,
        score,
      });
      evaluators.add(col.evaluator);
      criteria.add(col.criterion);
      const inner = coverage.get(col.evaluator) ?? new Map();
      inner.set(col.criterion, (inner.get(col.criterion) ?? 0) + 1);
      coverage.set(col.evaluator, inner);
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

/** True when every column has both evaluator and criterion. */
export function isPlanReady(plan: PivotPlan): boolean {
  if (!plan.idColumn) return false;
  for (const c of plan.columns) {
    if (!c.evaluator || !c.criterion) return false;
  }
  return true;
}

/**
 * Return the first column that is not yet ready, so the UI can highlight it
 * and scroll to the right row. null = plan is ready.
 */
export function firstUnmappedColumn(plan: PivotPlan): string | null {
  for (const c of plan.columns) {
    if (!c.evaluator || !c.criterion) return c.header;
  }
  return null;
}
