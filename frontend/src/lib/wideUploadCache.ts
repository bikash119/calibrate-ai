/**
 * Per-project mapping cache for the wide-upload wizard.
 *
 * Three evaluator files = three uploads = three identical column→criterion
 * mappings. Without a cache the operator picks the same dropdowns three
 * times. This stores the last successful mapping in localStorage and
 * applies it to subsequent uploads (matched by header text).
 *
 * Evaluator id is NOT cached — each file is a different evaluator.
 *
 * Pure module: no React, no fetch. Testable.
 */

import type { PivotPlan, ScoreUploadLayout } from "./humanScoresWide";

const STORAGE_PREFIX = "wide-upload-mappings:v1";

/** What the cache stores per project. Schema is versioned via the key
 *  prefix so future migrations don't silently corrupt older caches. */
export interface WideUploadCache {
  /** Layout choice from the previous successful upload. */
  layout: ScoreUploadLayout;
  /** Header text of the id column. We try to match by text on the next
   *  upload — if the new file uses a different id-column header, the
   *  match is dropped silently. */
  idColumnHeader: string | null;
  /** header → { criterion, excluded }. Headers that don't appear in the
   *  next file are silently ignored on apply. */
  columnMappings: Record<string, { criterion: string | null; excluded: boolean }>;
}

const KEY = (projectId: number): string => `${STORAGE_PREFIX}:${projectId}`;

/** Read the cached mapping for a project. Returns null if nothing's there
 *  or the stored value is malformed. */
export function loadCache(
  projectId: number,
  storage: Storage | null = safeStorage(),
): WideUploadCache | null {
  if (!storage) return null;
  const raw = storage.getItem(KEY(projectId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isWideUploadCache(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the project's current mapping. Called on successful upload. */
export function saveCache(
  projectId: number,
  cache: WideUploadCache,
  storage: Storage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEY(projectId), JSON.stringify(cache));
  } catch {
    // Quota exceeded / disabled — fall back silently. The wizard still works,
    // just without the cross-file inheritance.
  }
}

/** Drop the cache for a project (e.g. after the rubric changed). */
export function clearCache(
  projectId: number,
  storage: Storage | null = safeStorage(),
): void {
  if (!storage) return;
  storage.removeItem(KEY(projectId));
}

/** Build a cache snapshot from a finished plan. The returned object is
 *  what `saveCache` should persist. */
export function planToCache(plan: PivotPlan): WideUploadCache {
  const columnMappings: WideUploadCache["columnMappings"] = {};
  for (const col of plan.columns) {
    columnMappings[col.header] = {
      criterion: col.criterion,
      excluded: col.excluded,
    };
  }
  return {
    layout: plan.layout,
    idColumnHeader: plan.idColumn,
    columnMappings,
  };
}

/** Apply a cached mapping to a freshly-detected plan. Headers in the new
 *  file that match a cached entry inherit `criterion` and `excluded`.
 *  Headers absent from the cache are left as-is.
 *
 *  The cache's layout and idColumnHeader are restored unconditionally —
 *  the operator can override either if a new file's schema diverges. We
 *  considered validating that the cached id column still exists, but
 *  decided trusting the cache is simpler: if it's stale, isPlanReady's
 *  pivot will return zero rows and the operator notices. */
export function applyCacheToPlan(
  plan: PivotPlan,
  cache: WideUploadCache,
): PivotPlan {
  return {
    ...plan,
    idColumn: cache.idColumnHeader ?? plan.idColumn,
    layout: cache.layout,
    columns: plan.columns.map((col) => {
      const cached = cache.columnMappings[col.header];
      if (!cached) return col;
      return {
        ...col,
        criterion: cached.criterion,
        criterionMatched: cached.criterion !== null,
        excluded: cached.excluded,
      };
    }),
  };
}

// ------------------------------------------------------------------ //

function isWideUploadCache(v: unknown): v is WideUploadCache {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.layout !== "per-column" && o.layout !== "per-file") return false;
  if (o.idColumnHeader !== null && typeof o.idColumnHeader !== "string") return false;
  if (!o.columnMappings || typeof o.columnMappings !== "object") return false;
  for (const v of Object.values(o.columnMappings as Record<string, unknown>)) {
    if (!v || typeof v !== "object") return false;
    const e = v as Record<string, unknown>;
    if (e.criterion !== null && typeof e.criterion !== "string") return false;
    if (typeof e.excluded !== "boolean") return false;
  }
  return true;
}

/** localStorage in a browser, undefined in node tests / SSR. */
function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
