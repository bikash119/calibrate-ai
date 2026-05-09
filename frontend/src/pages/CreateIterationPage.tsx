/**
 * Create iteration v(N+1) — flat form with sticky cost rail.
 *
 * Mirrors the Claude Design "create-iteration" mock. The shape is "shape A"
 * (reuse-on-no-change): the operator picks which criteria to edit; untouched
 * criteria reuse the previous iteration's LLM scores, so a new version only
 * costs LLM tokens for what actually changed.
 *
 * Status: UI mock. The submit button is a placeholder — the backend for
 * sparse-overlay iterations + selective scoring isn't wired yet (deferred).
 */

import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Flag,
  Info,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { Banner } from "../components/ui/Banner";
import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import {
  TrafficLight,
  trafficStatusFor,
  type TrafficStatus,
} from "../components/ui/TrafficLight";
import { useBaseline } from "../hooks/useBaseline";
import { useRubric } from "../hooks/useRubric";

// ------------------------------------------------------------------ //
// Mock helpers (no backend hooks yet for these — design uses fixtures)
// ------------------------------------------------------------------ //

/** Synthesized "what v(N) got wrong" entries per criterion. Real wiring
 *  would come from a `useDisagreements(projectId, iterationId, flag="human_correct")` hook. */
function mockLessons(criterionId: number): {
  appId: string;
  llm: number;
  human: number;
  reason: string;
}[] {
  // Deterministic, criterion-id-keyed, no API calls. Just placeholder text.
  const seeds = ["APP-0073", "APP-0142", "APP-0207"];
  const base = (criterionId * 7) % 5;
  return seeds.slice(0, 3).map((appId, i) => ({
    appId,
    llm: ((base + i) % 4) + 1,
    human: ((base + i + 2) % 4) + 1,
    reason:
      i === 0
        ? "LLM rewarded surface specificity over substantive scope."
        : i === 1
          ? "LLM under-credited concrete pilot evidence."
          : "LLM applied criterion's anchors too leniently for partial coverage.",
  }));
}

const MOCK_EXAMPLES = [
  { app: "APP-0073", source: "operator_flagged", score: 5, delta: -2, on: true },
  { app: "APP-0142", source: "operator_flagged", score: 2, delta: 2, on: true },
  { app: "APP-0091", source: "evaluator_consensus", score: 3, delta: 0, on: true },
  { app: "APP-0118", source: "evaluator_consensus", score: 4, delta: 0, on: true },
  { app: "APP-0207", source: "auto", score: 2, delta: 1, on: true },
  { app: "APP-0312", source: "auto", score: 4, delta: 0, on: false },
];

// ------------------------------------------------------------------ //

interface CriterionRow {
  id: number;
  name: string;
  description: string;
  qwk: number;
  qwkLow: number;
  /** Synthetic LLM-H per-criterion proxy. Real wiring: latest iteration's
   *  per-criterion QWK on the dev split. Here we offset baseline by a fixed
   *  amount so the traffic light renders meaningfully. */
  llmH: number;
  exampleCount: number;
  errorCount: number;
}

export function CreateIterationPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;
  const navigate = useNavigate();

  const rubric = useRubric(projectId);
  const baseline = useBaseline(projectId);

  // Until we wire a real "current iteration version" hook, treat the from
  // version as 1 and the new version as 2 — the design used 4 → 5; the exact
  // number doesn't change the screen's structure.
  const fromVersion = 1;
  const toVersion = fromVersion + 1;

  const criteria: CriterionRow[] = useMemo(() => {
    const items = rubric.data?.criteria ?? [];
    return items.map((c) => {
      const m = baseline.data?.per_criterion.find(
        (p) => p.criterion_id === c.id && p.metric === "qwk",
      );
      const qwk = m?.value ?? 0;
      const low = m?.ci_low ?? Math.max(0, qwk - 0.05);
      // No "latest LLM-H" hook bound here — synthesize for the traffic light.
      const llmH = Math.max(0, qwk - 0.07);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        qwk,
        qwkLow: low,
        llmH,
        exampleCount: 8,
        errorCount: 5,
      };
    });
  }, [rubric.data, baseline.data]);

  // ---- form state -------------------------------------------------- //

  // Default-empty so the operator must explicitly pick.
  const [edited, setEdited] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [postCreate, setPostCreate] = useState({
    scoreDev: false,
    computeMetrics: true,
    autoPromote: false,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [suggestionModel, setSuggestionModel] = useState("claude-opus-4-7");
  const [devSampleSize, setDevSampleSize] = useState(247);
  const [lessonCap, setLessonCap] = useState(5);

  const editedIds = criteria.filter((c) => edited[c.id]).map((c) => c.id);
  const reusedIds = criteria.filter((c) => !edited[c.id]).map((c) => c.id);

  // ---- cost estimate ---------------------------------------------- //
  const callsPerCriterion = devSampleSize;
  const totalCalls = editedIds.length * callsPerCriterion;
  const costPerCall = 0.0077; // ~ for sonnet at ~1.5k tokens
  const estCost = totalCalls * costPerCall;
  const reusedSavings = reusedIds.length * callsPerCriterion * costPerCall;

  // Auto-expand the first edited criterion if nothing is currently expanded.
  if (expanded == null && editedIds.length > 0) {
    // Read-only effect simulated by initializing from state in render. To
    // avoid a setState in render, just compute the desired expanded id —
    // we set it inside the toggle callbacks below.
  }
  const effectiveExpanded =
    expanded ?? (editedIds.length > 0 ? editedIds[0] : null);

  return (
    <div>
      <PageHead
        eyebrow={`Phase 3 · From v${fromVersion}`}
        title={`Create iteration v${toVersion}`}
        lede="Pick the criteria you want to revise. Untouched criteria reuse v1's scores — no new spend, no contamination of the convergence chart. You'll review a diff before any LLM run is committed."
        actions={
          <button
            className="btn"
            onClick={() => navigate(`/projects/${projectId}/iterate`)}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Cancel
          </button>
        }
      />

      <div
        className="grid items-start gap-6"
        style={{ gridTemplateColumns: "1fr 320px" }}
      >
        {/* ============== LEFT: form ============== */}
        <div className="grid gap-4">
          {/* SCOPE ------------------------------------------------------ */}
          <Card
            title="1. Scope"
            desc="Which criteria are you editing this round?"
            action={
              <div className="flex items-center gap-1.5">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setEdited(
                      Object.fromEntries(criteria.map((c) => [c.id, true])),
                    )
                  }
                >
                  Select all
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setEdited({})}
                >
                  Clear
                </button>
              </div>
            }
          >
            {criteria.length === 0 ? (
              <div className="text-sm text-[var(--fg-muted)]">
                No criteria yet — save the rubric first.
              </div>
            ) : (
              <div
                className="grid gap-2.5"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(
                    5,
                    Math.max(1, criteria.length),
                  )}, minmax(0, 1fr))`,
                }}
              >
                {criteria.map((c) => {
                  const status: TrafficStatus = trafficStatusFor(c.llmH, {
                    qwkLow: c.qwkLow,
                  });
                  const isEdited = !!edited[c.id];
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        setEdited((e) => ({ ...e, [c.id]: !e[c.id] }))
                      }
                      style={{
                        textAlign: "left",
                        background: isEdited
                          ? "var(--accent-bg)"
                          : "var(--bg-elevated)",
                        border: `1.5px solid ${
                          isEdited ? "var(--accent)" : "var(--border)"
                        }`,
                        borderRadius: "var(--radius-md)",
                        padding: 12,
                        cursor: "pointer",
                        transition: "border-color 80ms ease",
                        position: "relative",
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className="font-mono text-[11px]"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          Crit {c.id}
                        </span>
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            border: `1.5px solid ${
                              isEdited
                                ? "var(--accent)"
                                : "var(--border-strong)"
                            }`,
                            background: isEdited ? "var(--accent)" : "transparent",
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          {isEdited && (
                            <Check
                              size={9}
                              strokeWidth={3}
                              style={{ color: "var(--accent-fg, white)" }}
                            />
                          )}
                        </span>
                      </div>
                      <div
                        className="text-xs font-medium leading-snug mb-2"
                        style={{ minHeight: 32 }}
                        title={c.name}
                      >
                        {c.name}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <TrafficLight status={status} />
                        <span className="text-[11px] [font-variant-numeric:tabular-nums]">
                          {c.llmH.toFixed(2)}
                        </span>
                        <span
                          className="text-[10px] [font-variant-numeric:tabular-nums]"
                          style={{ color: "var(--fg-faint)" }}
                        >
                          / {c.qwk.toFixed(2)}
                        </span>
                      </div>
                      {!isEdited && (
                        <div
                          className="text-[10px] mt-1.5 italic"
                          style={{ color: "var(--fg-faint)" }}
                        >
                          reused from v{fromVersion}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              className="mt-3.5 px-3 py-2.5 text-xs flex flex-wrap gap-4"
              style={{
                background: "var(--bg-sunken)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <div>
                <span style={{ color: "var(--fg-muted)" }}>Editing</span>{" "}
                <strong>{editedIds.length}</strong>{" "}
                <span style={{ color: "var(--fg-faint)" }}>
                  / {criteria.length}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--fg-muted)" }}>
                  Reusing v{fromVersion} scores for
                </span>{" "}
                <strong>{reusedIds.length}</strong>{" "}
                <span style={{ color: "var(--fg-muted)" }}>criteria</span>
                <span className="mx-2" style={{ color: "var(--fg-faint)" }}>
                  ·
                </span>
                <span style={{ color: "var(--fg-muted)" }}>saves</span>{" "}
                <strong className="[font-variant-numeric:tabular-nums]">
                  ${reusedSavings.toFixed(2)}
                </strong>
              </div>
            </div>
          </Card>

          {/* PER-CRITERION EDITS ---------------------------------------- */}
          {editedIds.length === 0 && criteria.length > 0 && (
            <Banner kind="info" title="Pick at least one criterion to edit.">
              No edits, no new iteration. If you want to re-score everything
              from scratch, head back to History and roll forward from there.
            </Banner>
          )}

          {editedIds.map((id) => {
            const row = criteria.find((c) => c.id === id)!;
            return (
              <CriterionEditor
                key={id}
                row={row}
                fromVersion={fromVersion}
                toVersion={toVersion}
                isOpen={effectiveExpanded === id}
                onToggle={() =>
                  setExpanded(effectiveExpanded === id ? null : id)
                }
              />
            );
          })}

          {/* AFTER CREATE ------------------------------------------------ */}
          {editedIds.length > 0 && (
            <Card
              title="2. After creation"
              desc="What runs automatically. The LLM-spend step is opt-in by design — you should see the diff first."
            >
              <div className="grid gap-2.5">
                <CheckRow
                  checked={postCreate.computeMetrics}
                  onChange={(v) =>
                    setPostCreate((s) => ({ ...s, computeMetrics: v }))
                  }
                  label="Compute LLM-H metrics for reused criteria"
                  sublabel="Free. Just runs the agreement math against v1's existing scores."
                />
                <CheckRow
                  checked={postCreate.scoreDev}
                  onChange={(v) =>
                    setPostCreate((s) => ({ ...s, scoreDev: v }))
                  }
                  label={
                    <>
                      Score edited criteria on dev split{" "}
                      <span
                        className="pill pill-yellow ml-1.5"
                        style={{ fontSize: 11 }}
                      >
                        ~${estCost.toFixed(2)}
                      </span>
                    </>
                  }
                  sublabel="Off by default. Land on the diff first; commit spend explicitly from there."
                  warn
                />
                <CheckRow
                  checked={postCreate.autoPromote}
                  onChange={(v) =>
                    setPostCreate((s) => ({ ...s, autoPromote: v }))
                  }
                  label="Auto-promote winning lessons to calibration_examples"
                  sublabel="Off by default — mutating shared examples as a side effect of one iteration is risky."
                />
              </div>
            </Card>
          )}

          {/* ADVANCED ---------------------------------------------------- */}
          {editedIds.length > 0 && (
            <div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setAdvancedOpen((o) => !o)}
                style={{ paddingLeft: 0 }}
              >
                {advancedOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Advanced settings
              </button>
              {advancedOpen && (
                <Card>
                  <div
                    className="grid gap-4"
                    style={{ gridTemplateColumns: "1fr 1fr" }}
                  >
                    <Field
                      label="Scoring model"
                      help="Different from the suggestion model below — useful for closing the feedback loop."
                    >
                      <select
                        className="select"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                        <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                        <option value="claude-opus-4-7">claude-opus-4-7</option>
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      </select>
                    </Field>
                    <Field
                      label="Suggestion model (auto-suggest)"
                      help="Defaults to a stronger model so the suggester isn't the same one that mis-scored."
                    >
                      <select
                        className="select"
                        value={suggestionModel}
                        onChange={(e) => setSuggestionModel(e.target.value)}
                      >
                        <option value="claude-opus-4-7">claude-opus-4-7</option>
                        <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                      </select>
                    </Field>
                    <Field
                      label="Dev-split sample size"
                      help={`Default 247 (full dev). Reduce for faster iteration on cost-sensitive runs.`}
                    >
                      <input
                        className="input"
                        type="number"
                        value={devSampleSize}
                        onChange={(e) =>
                          setDevSampleSize(parseInt(e.target.value) || 247)
                        }
                      />
                    </Field>
                    <Field
                      label="Lesson cap per criterion"
                      help={`Max v(N) errors auto-rendered into the "Lessons" prompt section.`}
                    >
                      <input
                        className="input"
                        type="number"
                        value={lessonCap}
                        onChange={(e) =>
                          setLessonCap(parseInt(e.target.value) || 5)
                        }
                      />
                    </Field>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* ============== RIGHT: sticky summary rail ============== */}
        <div className="sticky" style={{ top: 80 }}>
          <Card>
            <div className="mb-3.5">
              <div
                className="text-[11px] uppercase tracking-wide mb-1"
                style={{ color: "var(--fg-faint)", letterSpacing: "0.06em" }}
              >
                Creating
              </div>
              <div className="text-lg font-semibold tracking-tight">
                Iteration v{toVersion}
              </div>
              <div
                className="text-xs"
                style={{ color: "var(--fg-muted)" }}
              >
                from v{fromVersion} ·{" "}
                {new Date().toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>

            <hr className="my-2" style={{ borderColor: "var(--border)" }} />

            <SummaryRow
              label="Criteria edited"
              value={`${editedIds.length} of ${criteria.length}`}
              detail={
                editedIds.length
                  ? editedIds.map((id) => `Crit ${id}`).join(" · ")
                  : "—"
              }
            />
            <SummaryRow
              label="Criteria reused"
              value={reusedIds.length}
              detail={`v${fromVersion} scores carry forward — $${reusedSavings.toFixed(
                2,
              )} saved`}
            />
            <SummaryRow label="Dev applications" value={devSampleSize} />
            <SummaryRow
              label="Model calls (if you run)"
              value={totalCalls.toLocaleString()}
            />

            <hr className="my-3" style={{ borderColor: "var(--border)" }} />

            <div className="mb-3.5">
              <div className="flex items-baseline justify-between">
                <span
                  className="text-xs"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Estimated spend
                </span>
                <span
                  className="text-2xl font-semibold tracking-tight [font-variant-numeric:tabular-nums]"
                >
                  ${estCost.toFixed(2)}
                </span>
              </div>
              <div
                className="text-[11px] mt-0.5"
                style={{ color: "var(--fg-faint)" }}
              >
                Only billed if you choose to score on dev. Creating the
                iteration record is free.
              </div>
            </div>

            <div className="grid gap-1.5">
              <button
                className="btn btn-primary btn-lg w-full justify-center"
                disabled={editedIds.length === 0}
                title={
                  editedIds.length === 0
                    ? "Pick at least one criterion to edit"
                    : "Backend not yet wired — UI mock"
                }
                onClick={() => {
                  // TODO: wire to POST /iterations with sparse prompt overlay
                  // (shape A). For now, navigate back so the click does
                  // *something* visible.
                  alert(
                    "Backend not wired yet — this is a UI mock. The action would create v" +
                      toVersion +
                      (postCreate.scoreDev ? " and queue scoring." : "."),
                  );
                  navigate(`/projects/${projectId}/iterate`);
                }}
              >
                <Check className="w-4 h-4" /> Create v{toVersion}
                {postCreate.scoreDev ? " & run" : ""}
              </button>
              <button className="btn w-full justify-center">
                <FileText className="w-3.5 h-3.5" /> Save as draft
              </button>
            </div>

            <hr
              className="mt-4 mb-3"
              style={{ borderColor: "var(--border)" }}
            />

            <div className="flex items-center gap-1.5 mb-1">
              <Info
                className="w-3 h-3"
                style={{ color: "var(--fg-muted)" }}
              />
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--fg-muted)" }}
              >
                Reversibility
              </span>
            </div>
            <div
              className="text-[11px] leading-relaxed"
              style={{ color: "var(--fg-muted)" }}
            >
              v{toVersion} starts as a <strong>draft</strong>. Mark it
              abandoned anytime — the convergence chart and lock step ignore
              abandoned iterations. v{fromVersion}'s scores stay intact.
            </div>
          </Card>

          {/* RAIL: per-version-per-criterion lock surface */}
          <div className="mt-4">
            <Card
              noPad
              title="Per-criterion versions"
              desc="Each criterion's effective version after this run."
            >
              <div className="py-1">
                {criteria.map((c) => {
                  const isEdit = !!edited[c.id];
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between px-4 py-2"
                      style={{
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span className="font-mono text-xs">Crit {c.id}</span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-[11px]"
                          style={{ color: "var(--fg-faint)" }}
                        >
                          v{fromVersion}
                        </span>
                        <ArrowRight
                          className="w-2.5 h-2.5"
                          style={{ color: "var(--fg-faint)" }}
                        />
                        <span
                          className={`pill ${isEdit ? "pill-accent" : ""} text-[10px]`}
                        >
                          v{isEdit ? toVersion : fromVersion}
                          {!isEdit && " (reused)"}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Per-criterion editor panel — collapsible
// ------------------------------------------------------------------ //

function CriterionEditor({
  row,
  fromVersion,
  toVersion,
  isOpen,
  onToggle,
}: {
  row: CriterionRow;
  fromVersion: number;
  toVersion: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<"prompt" | "lessons" | "examples">("prompt");
  const [prompt, setPrompt] = useState(
    `## Criterion ${row.id} — ${row.name}\n` +
      `Description: ${row.description}\n` +
      `Scale: 1 to 3\n`,
  );
  const [suggested, setSuggested] = useState(false);
  const [maxExamples, setMaxExamples] = useState(8);
  const [lessonsOn, setLessonsOn] = useState(true);

  const lessons = useMemo(() => mockLessons(row.id), [row.id]);

  return (
    <div
      className="card"
      style={{
        borderColor: isOpen ? "var(--accent-border)" : "var(--border)",
        transition: "border-color 80ms ease",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          background: isOpen ? "var(--accent-bg)" : "var(--bg-elevated)",
          border: "none",
          borderBottom: isOpen ? "1px solid var(--accent-border)" : "none",
          padding: "14px 20px",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {isOpen ? (
          <ChevronDown
            className="w-3.5 h-3.5"
            style={{ color: "var(--fg-muted)" }}
          />
        ) : (
          <ChevronRight
            className="w-3.5 h-3.5"
            style={{ color: "var(--fg-muted)" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold">
              Criterion {row.id}
            </span>
            <span className="font-medium text-sm truncate">{row.name}</span>
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: "var(--fg-muted)" }}
          >
            {row.errorCount} flagged disagreement
            {row.errorCount === 1 ? "" : "s"} from v{fromVersion} ·{" "}
            {row.exampleCount} active calibration examples
          </div>
        </div>
        {!isOpen && <span className="pill text-[10px]">Edit</span>}
      </button>

      {isOpen && (
        <div className="card-pad" style={{ background: "var(--bg)" }}>
          {/* Tab strip */}
          <div
            className="flex"
            style={{
              borderBottom: "1px solid var(--border)",
              marginBottom: 14,
            }}
          >
            {(
              [
                ["prompt", "Prompt", Pencil],
                ["lessons", `Lessons from v${fromVersion}`, Flag],
                ["examples", `Examples (${row.exampleCount})`, Layers],
              ] as const
            ).map(([k, label, Ic]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${
                    tab === k ? "var(--accent)" : "transparent"
                  }`,
                  padding: "8px 14px",
                  cursor: "pointer",
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  fontSize: 13,
                  color: tab === k ? "var(--fg)" : "var(--fg-muted)",
                  fontWeight: tab === k ? 500 : 400,
                  marginBottom: -1,
                }}
              >
                <Ic className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>

          {/* PROMPT TAB */}
          {tab === "prompt" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <button className="btn btn-sm">
                    <Eye className="w-3 h-3" /> Diff vs v{fromVersion}
                  </button>
                  <button className="btn btn-sm">
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {!suggested ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => setSuggested(true)}
                    >
                      <Sparkles className="w-3 h-3" /> Suggest refinement
                    </button>
                  ) : (
                    <span className="pill pill-accent text-[10px]">
                      <Sparkles className="w-2.5 h-2.5 inline mr-1" />
                      Suggestion ready — review below
                    </span>
                  )}
                </div>
              </div>

              {suggested && (
                <div
                  style={{
                    background: "var(--accent-bg)",
                    border: "1px solid var(--accent-border)",
                    borderRadius: "var(--radius-sm)",
                    padding: 12,
                    marginBottom: 12,
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles
                      className="w-3 h-3"
                      style={{ color: "var(--accent)" }}
                    />
                    <strong style={{ color: "var(--accent)" }}>
                      Suggested refinement (claude-opus-4-7)
                    </strong>
                  </div>
                  <div style={{ color: "var(--fg-muted)" }}>
                    Based on {row.errorCount} flagged disagreements where
                    humans corrected the LLM, this draft adds an explicit rule:{" "}
                    <em>
                      "When pilot results are cited with a numeric outcome,
                      treat the magnitude itself as evidence — do not require
                      an additional denominator unless the criterion's anchors
                      demand it."
                    </em>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button className="btn btn-sm btn-primary">
                      Apply to prompt
                    </button>
                    <button className="btn btn-sm">View full diff</button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setSuggested(false)}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              <textarea
                className="textarea"
                rows={10}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div
                className="text-[11px] mt-1.5"
                style={{ color: "var(--fg-faint)" }}
              >
                Operator section only. The auto-generated rubric block is
                read-only and re-emitted on save.
              </div>
            </div>
          )}

          {/* LESSONS TAB */}
          {tab === "lessons" && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <div className="text-sm font-medium">
                    What v{fromVersion} got wrong
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    Auto-built from disagreement_flags where you tagged "human
                    correct". Rendered as a "Lessons" block in the prompt.
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-xs"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    Include in prompt
                  </span>
                  <Toggle
                    on={lessonsOn}
                    onToggle={() => setLessonsOn((v) => !v)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                {lessons.map((l) => (
                  <div
                    key={l.appId}
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "10px 14px",
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {l.appId}
                        </span>
                        <span className="pill text-[10px]">
                          LLM <strong>{l.llm}</strong>
                          <span
                            className="mx-1"
                            style={{ color: "var(--fg-faint)" }}
                          >
                            vs human
                          </span>
                          <strong>{l.human}</strong>
                        </span>
                      </div>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Promote to a calibration_example for future iterations"
                      >
                        <Plus className="w-2.5 h-2.5" /> Promote to example
                      </button>
                    </div>
                    <div
                      className="text-xs leading-relaxed"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {l.reason}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="mt-3 px-3 py-2.5 text-xs leading-relaxed"
                style={{
                  background: "var(--info-bg)",
                  border: "1px solid var(--info-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--fg-muted)",
                }}
              >
                <strong style={{ color: "var(--info)" }}>
                  Why a separate section, not auto-promoting to examples?
                </strong>{" "}
                Lessons are scoped to v{toVersion}. Promoting them mutates a
                shared resource as a side effect of one iteration — keep that
                explicit, per-row.
              </div>
            </div>
          )}

          {/* EXAMPLES TAB */}
          {tab === "examples" && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <div className="text-sm font-medium">
                    Calibration examples for this prompt
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    Default: include all <code>is_active=1</code>. Sort affects
                    display order; toggle off to exclude.
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-xs"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    Max
                  </span>
                  <input
                    className="input"
                    type="number"
                    value={maxExamples}
                    onChange={(e) =>
                      setMaxExamples(parseInt(e.target.value) || 0)
                    }
                    style={{ width: 64 }}
                  />
                </div>
              </div>

              <div
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                }}
              >
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th>Application</th>
                      <th>Source</th>
                      <th>Score</th>
                      <th>Δ vs v{fromVersion}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_EXAMPLES.map((ex) => (
                      <tr key={ex.app}>
                        <td>
                          <Toggle on={ex.on} />
                        </td>
                        <td className="font-mono text-xs">{ex.app}</td>
                        <td>
                          <span
                            className={`pill ${
                              ex.source === "operator_flagged"
                                ? "pill-accent"
                                : ex.source === "evaluator_consensus"
                                  ? "pill-info"
                                  : ""
                            } text-[10px]`}
                          >
                            {ex.source}
                          </span>
                        </td>
                        <td className="[font-variant-numeric:tabular-nums]">
                          {ex.score}
                        </td>
                        <td className="[font-variant-numeric:tabular-nums]">
                          {ex.delta === 0 ? (
                            <span style={{ color: "var(--fg-faint)" }}>—</span>
                          ) : (
                            <span style={{ color: "var(--fg-muted)" }}>
                              {ex.delta > 0 ? "+" : ""}
                              {ex.delta}
                            </span>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-sm btn-ghost">
                            <Eye className="w-2.5 h-2.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //
// Small primitives
// ------------------------------------------------------------------ //

function SummaryRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {label}
        </span>
        <span className="text-[13px] font-medium [font-variant-numeric:tabular-nums]">
          {value}
        </span>
      </div>
      {detail && (
        <div
          className="text-[11px] mt-0.5"
          style={{ color: "var(--fg-faint)" }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  sublabel,
  warn,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  sublabel?: string;
  warn?: boolean;
}) {
  const style: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 12px",
    border: `1px solid ${
      checked
        ? warn
          ? "var(--yellow-border)"
          : "var(--accent-border)"
        : "var(--border)"
    }`,
    background: checked
      ? warn
        ? "var(--yellow-bg)"
        : "var(--accent-bg)"
      : "var(--bg-elevated)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    transition: "border-color 80ms ease, background 80ms ease",
  };
  return (
    <label style={style}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <div style={{ flex: 1 }}>
        <div className="text-[13px] font-medium">{label}</div>
        {sublabel && (
          <div
            className="text-xs mt-0.5"
            style={{ color: "var(--fg-muted)" }}
          >
            {sublabel}
          </div>
        )}
      </div>
    </label>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  return (
    <span
      onClick={onToggle}
      style={{
        display: "inline-block",
        width: 28,
        height: 16,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--border-strong)",
        position: "relative",
        transition: "background 80ms ease",
        flexShrink: 0,
        cursor: onToggle ? "pointer" : "default",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "white",
          transition: "left 120ms ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        }}
      />
    </span>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label
        className="text-xs font-medium"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </label>
      {children}
      {help && (
        <div
          className="text-[11px]"
          style={{ color: "var(--fg-faint)" }}
        >
          {help}
        </div>
      )}
    </div>
  );
}
