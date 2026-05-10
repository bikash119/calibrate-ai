/**
 * Pick which (criterion, application) pairs from the parent iteration's dev
 * run should become calibration_examples for v(N+1)'s prompt.
 *
 * Two inner tabs:
 *   - Disagreements (LLM ≠ human median) → promote with source='operator_flagged'
 *   - Agreements (LLM = human median)    → promote with source='manual'
 *
 * Currently-active examples appear in a "Currently active" panel at the
 * bottom; the operator can deactivate them in the same dialog. Save runs
 * one mutation per change — partial failures keep the modal open with
 * per-row error indicators so the operator can retry the remainder.
 */

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";

import { Modal } from "../../components/ui/Modal";
import {
  usePromoteCalibrationExample,
  useCalibrationExamples,
  useSetExampleActive,
} from "../../hooks/useCalibration";
import { useDisagreements } from "../../hooks/useDisagreements";
import type { CalibrationExampleItem, DisagreementItem } from "../../schemas";

interface Props {
  projectId: number;
  criterionId: number;
  criterionName: string;
  parentIterationId: number | null;
  onClose: () => void;
}

type Tab = "disagreements" | "agreements";

export function SelectExamplesModal({
  projectId,
  criterionId,
  criterionName,
  parentIterationId,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("disagreements");
  // Newly-checked candidates the operator wants to promote.
  // Key = `${appId}` so we can hold both disagreements (any delta) and
  // agreements (delta=0) in the same Set.
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  // Active examples the operator has deactivated this session.
  const [deactivated, setDeactivated] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [perRowErrors, setPerRowErrors] = useState<Record<string, string>>({});

  const examplesQ = useCalibrationExamples(projectId, criterionId);
  const disagreementsQ = useDisagreements(
    projectId, parentIterationId ?? undefined, "dev",
    { kind: "disagreement" },
  );
  const agreementsQ = useDisagreements(
    projectId, parentIterationId ?? undefined, "dev",
    { kind: "agreement" },
  );

  const promote = usePromoteCalibrationExample(projectId, criterionId);
  const setActive = useSetExampleActive(projectId, criterionId);

  // Filter to current criterion. Backend returns all criteria's rows for
  // the iteration; we only show this criterion's.
  const disagreements = (disagreementsQ.data?.disagreements ?? []).filter(
    (d) => d.criterion_id === criterionId,
  );
  const agreements = (agreementsQ.data?.disagreements ?? []).filter(
    (d) => d.criterion_id === criterionId,
  );

  // Apps already promoted (active OR inactive) — don't show them as
  // candidates so the operator can't double-promote.
  const alreadyPromotedAppIds = useMemo(() => {
    const set = new Set<number>();
    for (const ex of examplesQ.data?.examples ?? []) {
      set.add(ex.application_id);
    }
    return set;
  }, [examplesQ.data]);

  const activeExamples = (examplesQ.data?.examples ?? []).filter(
    (ex) => ex.is_active,
  );

  const togglePick = (appId: number) => {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };
  const toggleDeactivate = (exampleId: number) => {
    setDeactivated((s) => {
      const next = new Set(s);
      if (next.has(exampleId)) next.delete(exampleId);
      else next.add(exampleId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setPerRowErrors({});
    const errors: Record<string, string> = {};

    // 1. Promotions
    for (const appId of picked) {
      // Find the row in either tab to get its human_median + source.
      const fromDis = disagreements.find((d) => d.application_id === appId);
      const fromAgr = agreements.find((d) => d.application_id === appId);
      const row = fromDis ?? fromAgr;
      if (!row) continue;
      const source: "operator_flagged" | "manual" = fromDis
        ? "operator_flagged"
        : "manual";
      try {
        await promote.mutateAsync({
          applicationId: appId,
          // human_median is a float (median of N evaluators); calibration
          // examples store integer human_score, so round.
          humanScore: Math.round(row.human_median),
          source,
        });
      } catch (e) {
        errors[`promote-${appId}`] =
          e instanceof Error ? e.message : "Promotion failed";
      }
    }

    // 2. Deactivations
    for (const exId of deactivated) {
      try {
        await setActive.mutateAsync({ exampleId: exId, isActive: false });
      } catch (e) {
        errors[`deactivate-${exId}`] =
          e instanceof Error ? e.message : "Deactivate failed";
      }
    }

    setSaving(false);
    if (Object.keys(errors).length > 0) {
      setPerRowErrors(errors);
      // Don't close — let operator see + retry.
      return;
    }
    onClose();
  };

  const totalChanges = picked.size + deactivated.size;

  return (
    <Modal open onClose={onClose} width={920}>
      <div
        className="px-5 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">
              Select examples for {criterionName}
            </h3>
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--fg-muted)" }}
            >
              Pick disagreements (LLM was wrong) or agreements (LLM was
              right) to anchor the next iteration's prompt. Promoted rows
              get LLM-generated reasoning at save time.
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {parentIterationId == null ? (
        <div
          className="px-5 py-6 text-sm"
          style={{ color: "var(--fg-muted)" }}
        >
          No parent iteration to learn from yet. Create v1 and score it on
          dev first; then come back here.
        </div>
      ) : (
        <>
          {/* Tab strip */}
          <div
            className="flex"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {(
              [
                ["disagreements", `Disagreements (${disagreements.length})`],
                ["agreements", `Agreements (${agreements.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${
                    tab === k ? "var(--accent)" : "transparent"
                  }`,
                  padding: "10px 18px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: tab === k ? "var(--fg)" : "var(--fg-muted)",
                  fontWeight: tab === k ? 500 : 400,
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            className="px-5 py-4 overflow-y-auto"
            style={{ maxHeight: "55vh" }}
          >
            <CandidateList
              rows={tab === "disagreements" ? disagreements : agreements}
              kind={tab}
              alreadyPromoted={alreadyPromotedAppIds}
              picked={picked}
              onTogglePick={togglePick}
              loading={
                (tab === "disagreements"
                  ? disagreementsQ.isLoading
                  : agreementsQ.isLoading)
              }
              perRowErrors={perRowErrors}
            />

            {activeExamples.length > 0 && (
              <div
                className="mt-5 pt-4"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <div className="text-xs font-medium mb-2">
                  Currently active examples ({activeExamples.length})
                </div>
                <ActiveExamplesPanel
                  examples={activeExamples}
                  deactivated={deactivated}
                  onToggleDeactivate={toggleDeactivate}
                  perRowErrors={perRowErrors}
                />
              </div>
            )}
          </div>
        </>
      )}

      <div
        className="px-5 py-3 flex items-center justify-between gap-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {picked.size > 0 && `+${picked.size} to promote`}
          {picked.size > 0 && deactivated.size > 0 && " · "}
          {deactivated.size > 0 && `−${deactivated.size} to deactivate`}
          {totalChanges === 0 && "No changes yet"}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || totalChanges === 0}
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? "Saving…" : `Save ${totalChanges} change${totalChanges === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ //

function CandidateList({
  rows,
  kind,
  alreadyPromoted,
  picked,
  onTogglePick,
  loading,
  perRowErrors,
}: {
  rows: DisagreementItem[];
  kind: Tab;
  alreadyPromoted: Set<number>;
  picked: Set<number>;
  onTogglePick: (appId: number) => void;
  loading: boolean;
  perRowErrors: Record<string, string>;
}) {
  if (loading) {
    return (
      <div
        className="text-xs italic py-4"
        style={{ color: "var(--fg-muted)" }}
      >
        Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="text-xs italic py-4"
        style={{ color: "var(--fg-muted)" }}
      >
        {kind === "disagreements"
          ? "No disagreements on this criterion's dev split — either v(N) wasn't scored yet, or the LLM matched the human median on every app."
          : "No agreements on this criterion's dev split."}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      {rows.map((row) => {
        const already = alreadyPromoted.has(row.application_id);
        const isPicked = picked.has(row.application_id);
        const err = perRowErrors[`promote-${row.application_id}`];
        return (
          <label
            key={row.application_id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              border: `1px solid ${
                err
                  ? "var(--red-border)"
                  : isPicked
                    ? "var(--accent-border)"
                    : "var(--border)"
              }`,
              background: err
                ? "var(--red-bg)"
                : isPicked
                  ? "var(--accent-bg)"
                  : already
                    ? "var(--bg-sunken)"
                    : "var(--bg-elevated)",
              borderRadius: "var(--radius-sm)",
              cursor: already ? "not-allowed" : "pointer",
              opacity: already ? 0.55 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={isPicked}
              disabled={already}
              onChange={() => !already && onTogglePick(row.application_id)}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-xs font-semibold">
                  {row.application_external_id}
                </span>
                <span className="pill text-[10px]">
                  LLM <strong>{row.llm_score}</strong>
                  <span
                    className="mx-1"
                    style={{ color: "var(--fg-faint)" }}
                  >
                    vs human
                  </span>
                  <strong>{row.human_median}</strong>
                </span>
                {already && (
                  <span
                    className="text-[10px] italic"
                    style={{ color: "var(--fg-faint)" }}
                  >
                    already promoted
                  </span>
                )}
              </div>
              {row.llm_reasoning && (
                <div
                  className="text-[11px] leading-relaxed"
                  style={{
                    color: "var(--fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {row.llm_reasoning}
                </div>
              )}
              {err && (
                <div
                  className="text-[11px] mt-1"
                  style={{ color: "var(--red-fg)" }}
                >
                  {err}
                </div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

function ActiveExamplesPanel({
  examples,
  deactivated,
  onToggleDeactivate,
  perRowErrors,
}: {
  examples: CalibrationExampleItem[];
  deactivated: Set<number>;
  onToggleDeactivate: (exampleId: number) => void;
  perRowErrors: Record<string, string>;
}) {
  return (
    <div className="grid gap-1.5">
      {examples.map((ex) => {
        const willDeactivate = deactivated.has(ex.id);
        const err = perRowErrors[`deactivate-${ex.id}`];
        return (
          <div
            key={ex.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
            style={{
              border: `1px solid ${
                err
                  ? "var(--red-border)"
                  : willDeactivate
                    ? "var(--red-border)"
                    : "var(--border)"
              }`,
              background: err
                ? "var(--red-bg)"
                : willDeactivate
                  ? "var(--red-bg)"
                  : "var(--bg-elevated)",
              borderRadius: "var(--radius-sm)",
              opacity: willDeactivate ? 0.6 : 1,
              textDecoration: willDeactivate ? "line-through" : undefined,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs">
                {ex.application_external_id}
              </span>
              <span className="pill text-[10px]">
                Human <strong>{ex.human_score}</strong>
              </span>
              <span
                className={`pill text-[10px] ${
                  ex.source === "operator_flagged"
                    ? "pill-accent"
                    : ex.source === "evaluator_consensus"
                      ? "pill-info"
                      : ""
                }`}
              >
                {ex.source}
              </span>
            </div>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => onToggleDeactivate(ex.id)}
            >
              {willDeactivate ? "Keep active" : "Deactivate"}
            </button>
            {err && (
              <span
                className="text-[11px] ml-2"
                style={{ color: "var(--red-fg)" }}
              >
                {err}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
