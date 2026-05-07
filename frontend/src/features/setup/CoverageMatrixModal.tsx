/**
 * Coverage matrix view for already-loaded human scores. Pulls from the
 * existing `useHumanScores` query, so it stays in sync with whatever's in
 * the database.
 */
import { useMemo } from "react";
import { X } from "lucide-react";

import type { CriterionItem, HumanScoreItem } from "../../schemas";
import { CoverageGrid } from "./WideUploadModal";

interface Props {
  scores: HumanScoreItem[];
  criteria: CriterionItem[];
  onClose: () => void;
}

export function CoverageMatrixModal({ scores, criteria, onClose }: Props) {
  const { evaluators, critNames, coverage } = useMemo(() => {
    const evalSet = new Set<string>();
    const critById = new Map<number, string>();
    for (const c of criteria) critById.set(c.id, c.name);
    const cov = new Map<string, Map<string, number>>();
    for (const s of scores) {
      const critName = critById.get(s.criterion_id);
      if (!critName) continue;
      evalSet.add(s.evaluator_id);
      const inner = cov.get(s.evaluator_id) ?? new Map();
      // Each (evaluator, app, criterion) is one cell — count distinct apps,
      // not duplicate scores. The DB upserts so duplicates shouldn't exist;
      // if they do, we count them once.
      const key = `${s.application_id}::${critName}`;
      if (!inner.has(key)) {
        inner.set(key, 1);
        cov.set(s.evaluator_id, inner);
      }
    }
    // Now collapse the per-(app, criterion) map into per-criterion counts.
    const collapsed = new Map<string, Map<string, number>>();
    for (const [evaluator, inner] of cov.entries()) {
      const counts = new Map<string, number>();
      for (const k of inner.keys()) {
        const [, name] = k.split("::");
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      collapsed.set(evaluator, counts);
    }
    return {
      evaluators: [...evalSet].sort(),
      critNames: [...critById.values()].sort(),
      coverage: collapsed,
    };
  }, [scores, criteria]);

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
              Coverage matrix
            </h3>
            <p className="text-xs text-[var(--fg-muted)] mt-0.5">
              How many applications each evaluator scored per criterion. Gaps
              mean weak inter-rater coverage on that criterion.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {evaluators.length === 0 ? (
            <div className="text-sm text-[var(--fg-muted)]">
              No scores to display.
            </div>
          ) : (
            <CoverageGrid
              evaluators={evaluators}
              criteria={critNames}
              coverage={coverage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
