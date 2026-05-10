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
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
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
} from "../components/ui/TrafficLight";
import { SelectExamplesModal } from "../features/iterate/SelectExamplesModal";
import { useBaseline } from "../hooks/useBaseline";
import { useCalibrationExamples } from "../hooks/useCalibration";
import { useDisagreements } from "../hooks/useDisagreements";
import {
  useCreateIteration,
  useIteration,
  useIterations,
  useSuggestPrompt,
} from "../hooks/useIterations";
import { useRubric } from "../hooks/useRubric";
import type { CalibrationExampleItem, DisagreementItem } from "../schemas";

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
}

export function CreateIterationPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;
  const navigate = useNavigate();

  const rubric = useRubric(projectId);
  const baseline = useBaseline(projectId);
  const iterations = useIterations(projectId);
  const create = useCreateIteration(projectId ?? 0);

  // Use the project's latest iteration as the parent for shape-A inheritance.
  // If there are no iterations yet (new project), this is a "v1" creation
  // and the overlay path is bypassed (parent_iteration_id stays null).
  const parentIteration = useMemo(() => {
    const list = iterations.data?.iterations ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.version > b.version ? a : b));
  }, [iterations.data]);

  // Lessons + LLM-H come from the parent iteration's dev split.
  // Detail gives us per-criterion qwk for the traffic light; disagreements
  // give us "what v(N) got wrong" for each criterion's Lessons tab.
  const parentDetail = useIteration(projectId, parentIteration?.id);
  const parentDisagreements = useDisagreements(
    projectId,
    parentIteration?.id,
    "dev",
  );
  const llmHByCriterion = useMemo(() => {
    const map: Record<number, number> = {};
    for (const m of parentDetail.data?.dev_metrics ?? []) {
      if (m.qwk != null) map[m.criterion_id] = m.qwk;
    }
    return map;
  }, [parentDetail.data]);
  // The actual system prompt v(N) used for each criterion. This is what
  // the LLM sees at scoring time — the operator's textarea default should
  // match it so they're editing the real thing, not a placeholder.
  const parentPromptByCriterion = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of parentDetail.data?.prompts ?? []) {
      map[p.criterion_id] = p.system_prompt;
    }
    return map;
  }, [parentDetail.data]);
  const disagreementsByCriterion = useMemo(() => {
    const map: Record<number, DisagreementItem[]> = {};
    for (const d of parentDisagreements.data?.disagreements ?? []) {
      (map[d.criterion_id] ??= []).push(d);
    }
    return map;
  }, [parentDisagreements.data]);

  const fromVersion = parentIteration?.version ?? 0;
  const toVersion = fromVersion + 1;
  // Operator is editing prompts directly. The criterion-edit selector below
  // captures the "edited_criterion_ids" set; prompts come from the textarea
  // in each CriterionEditor.
  const [editedPromptText, setEditedPromptText] = useState<Record<number, string>>({});

  const criteria: CriterionRow[] = useMemo(() => {
    const items = rubric.data?.criteria ?? [];
    return items.map((c) => {
      const m = baseline.data?.per_criterion.find(
        (p) => p.criterion_id === c.id && p.metric === "qwk",
      );
      const qwk = m?.value ?? 0;
      const low = m?.ci_low ?? Math.max(0, qwk - 0.05);
      const llmH = llmHByCriterion[c.id] ?? Math.max(0, qwk - 0.07);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        qwk,
        qwkLow: low,
        llmH,
      };
    });
  }, [rubric.data, baseline.data, llmHByCriterion]);

  // ---- form state -------------------------------------------------- //

  // Multi-open accordions — each editor toggles independently. Default
  // all closed so the page is short on first paint; the operator opens
  // whichever criteria they want to work on.
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const toggleOpen = (id: number) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  // Auto-detect "edited" by comparing the operator's textarea text to the
  // parent iteration's stored prompt. Empty / unchanged → inherited.
  const editedIds = criteria
    .map((c) => c.id)
    .filter((id) => {
      const text = editedPromptText[id];
      if (text === undefined) return false;
      const parent = parentPromptByCriterion[id] ?? "";
      return text.trim() !== "" && text !== parent;
    });
  const reusedIds = criteria.filter((c) => !editedIds.includes(c.id)).map((c) => c.id);

  // ---- cost estimate ---------------------------------------------- //
  const callsPerCriterion = devSampleSize;
  const totalCalls = editedIds.length * callsPerCriterion;
  const costPerCall = 0.0077; // ~ for sonnet at ~1.5k tokens
  const estCost = totalCalls * costPerCall;
  const reusedSavings = reusedIds.length * callsPerCriterion * costPerCall;


  const submitIteration = async (asDraft: boolean) => {
    if (editedIds.length === 0 || projectId == null) return;
    const promptsBody = editedIds
      .filter((id) => editedPromptText[id] && editedPromptText[id]!.trim())
      .map((id) => ({
        criterion_id: id,
        system_prompt: editedPromptText[id]!,
      }));
    try {
      await create.mutateAsync({
        prompts: promptsBody,
        note: null,
        parent_iteration_id: parentIteration?.id ?? null,
        edited_criterion_ids: editedIds,
        as_draft: asDraft,
      });
      navigate(`/projects/${projectId}/iterate`);
    } catch {
      // surfaced via create.error in the rail
    }
  };

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
          {criteria.length === 0 && (
            <Banner kind="info" title="No criteria yet">
              Save the project's rubric before creating an iteration.
            </Banner>
          )}

          {criteria.length > 0 && (
            <div className="flex items-start justify-between gap-3">
              <div
                className="text-xs px-3 py-2 rounded-[var(--radius-sm)] flex-1"
                style={{
                  background: "var(--bg-sunken)",
                  color: "var(--fg-muted)",
                  lineHeight: 1.5,
                }}
              >
                Each criterion shows the system prompt v{fromVersion} uses
                today. Edit any of them to refine v{toVersion}; untouched
                criteria are inherited verbatim and don't trigger re-scoring.
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setOpenIds(new Set(criteria.map((c) => c.id)))
                  }
                  disabled={openIds.size === criteria.length}
                >
                  Expand all
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setOpenIds(new Set())}
                  disabled={openIds.size === 0}
                >
                  Collapse all
                </button>
              </div>
            </div>
          )}

          {criteria.map((c) => (
            <CriterionEditor
              key={c.id}
              row={c}
              projectId={projectId ?? 0}
              parentIterationId={parentIteration?.id ?? null}
              parentSystemPrompt={parentPromptByCriterion[c.id] ?? null}
              fromVersion={fromVersion}
              toVersion={toVersion}
              isEdited={editedIds.includes(c.id)}
              isOpen={openIds.has(c.id)}
              onToggle={() => toggleOpen(c.id)}
              promptText={editedPromptText[c.id]}
              onPromptChange={(text) =>
                setEditedPromptText((s) => ({ ...s, [c.id]: text }))
              }
              disagreementCount={
                (disagreementsByCriterion[c.id] ?? []).filter(
                  (d) => d.delta !== 0,
                ).length
              }
              lessonCap={lessonCap}
            />
          ))}

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
                disabled={editedIds.length === 0 || create.isPending}
                title={
                  editedIds.length === 0
                    ? "Pick at least one criterion to edit"
                    : undefined
                }
                onClick={() => submitIteration(false)}
              >
                <Check className="w-4 h-4" />
                {create.isPending
                  ? "Creating…"
                  : `Create v${toVersion}${postCreate.scoreDev ? " & run" : ""}`}
              </button>
              <button
                className="btn w-full justify-center"
                disabled={editedIds.length === 0 || create.isPending}
                onClick={() => submitIteration(true)}
              >
                <FileText className="w-3.5 h-3.5" />
                {create.isPending ? "Saving…" : "Save as draft"}
              </button>
              {create.error && (
                <div
                  className="text-xs px-2 py-1.5 rounded-[var(--radius-sm)]"
                  style={{
                    background: "var(--red-bg)",
                    border: "1px solid var(--red-border)",
                    color: "var(--red-fg)",
                  }}
                >
                  {create.error.message}
                </div>
              )}
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
  projectId,
  parentIterationId,
  parentSystemPrompt,
  fromVersion,
  toVersion,
  isEdited,
  isOpen,
  onToggle,
  promptText,
  onPromptChange,
  disagreementCount,
  lessonCap,
}: {
  row: CriterionRow;
  projectId: number;
  parentIterationId: number | null;
  /** The actual system prompt v(N) used for this criterion. The operator
   *  edits a copy of this; their changes only take effect when the new
   *  iteration is created. */
  parentSystemPrompt: string | null;
  fromVersion: number;
  toVersion: number;
  /** True when the operator has changed this criterion's prompt vs the
   *  parent's stored text. Drives the "Edited" badge + cost rail. */
  isEdited: boolean;
  isOpen: boolean;
  onToggle: () => void;
  /** Lifted prompt text — undefined falls back to the parent's stored prompt
   *  (or, if there's no parent yet, a minimal stub). */
  promptText: string | undefined;
  onPromptChange: (text: string) => void;
  /** Pre-computed count of disagreements vs parent — header summary only.
   *  Full data lives behind the SelectExamplesModal now. */
  disagreementCount: number;
  /** Cap passed through to the suggest-prompt call. */
  lessonCap: number;
}) {
  const [tab, setTab] = useState<"prompt" | "examples">("prompt");
  const [showExamplesModal, setShowExamplesModal] = useState(false);
  // Default to the parent iteration's stored prompt — what the LLM is
  // actually using today. Editing starts from there, not a fresh stub.
  const defaultPrompt =
    parentSystemPrompt ??
    `## ${row.name}\n` +
      (row.description ? `${row.description}\n` : "") +
      `(No parent iteration — this is a fresh prompt. The system will auto-render the rubric block on save.)\n`;
  const prompt = promptText ?? defaultPrompt;
  const setPrompt = onPromptChange;

  const suggestMut = useSuggestPrompt(projectId);
  const suggestion = suggestMut.data ?? null;
  const requestSuggestion = () => {
    if (parentIterationId == null) return;
    suggestMut.mutate({
      iterationId: parentIterationId,
      criterionId: row.id,
      currentPrompt: prompt,
      lessonCap,
    });
  };

  // Real calibration examples, fetched per criterion when this editor renders.
  const examplesQ = useCalibrationExamples(projectId, row.id);
  const examples = examplesQ.data?.examples ?? [];
  const activeExamples = examples.filter((e) => e.is_active);
  const exampleCount = activeExamples.length;
  const errorCount = disagreementCount;

  return (
    <div
      className="card"
      style={{
        borderColor: isEdited
          ? "var(--accent)"
          : isOpen
            ? "var(--accent-border)"
            : "var(--border)",
        transition: "border-color 80ms ease",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          background: isOpen
            ? isEdited
              ? "var(--accent-bg)"
              : "var(--bg-elevated)"
            : "var(--bg-elevated)",
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
          <div className="font-medium text-sm truncate" title={row.description}>
            {row.name}
          </div>
          <div
            className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap"
            style={{ color: "var(--fg-muted)" }}
          >
            <span
              className="flex items-center gap-1"
              title={`LLM-H QWK on v${fromVersion} dev split vs the H-H baseline ceiling`}
            >
              <TrafficLight
                status={trafficStatusFor(row.llmH, { qwkLow: row.qwkLow })}
              />
              <span className="[font-variant-numeric:tabular-nums]">
                LLM-H {row.llmH.toFixed(2)}
              </span>
              <span style={{ color: "var(--fg-faint)" }}>
                / H-H {row.qwk.toFixed(2)}
              </span>
            </span>
            <span style={{ color: "var(--fg-faint)" }}>·</span>
            <span>
              {errorCount} flagged disagreement
              {errorCount === 1 ? "" : "s"}
            </span>
            <span style={{ color: "var(--fg-faint)" }}>·</span>
            <span>{exampleCount} active examples</span>
          </div>
        </div>
        <span
          className={`pill text-[10px] ${isEdited ? "pill-accent" : ""}`}
          style={{ flexShrink: 0 }}
        >
          {isEdited
            ? `Edited → v${toVersion}`
            : `Reused from v${fromVersion}`}
        </span>
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
                ["examples", `Examples (${exampleCount})`, Layers],
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
                  {!suggestion ? (
                    <button
                      className="btn btn-sm"
                      onClick={requestSuggestion}
                      disabled={
                        parentIterationId == null || suggestMut.isPending
                      }
                      title={
                        parentIterationId == null
                          ? "No parent iteration to learn from yet — create v1 first."
                          : undefined
                      }
                    >
                      <Sparkles className="w-3 h-3" />
                      {suggestMut.isPending
                        ? "Drafting…"
                        : "Suggest refinement"}
                    </button>
                  ) : (
                    <span className="pill pill-accent text-[10px]">
                      <Sparkles className="w-2.5 h-2.5 inline mr-1" />
                      Suggestion ready — review below
                    </span>
                  )}
                </div>
              </div>

              {suggestMut.error && (
                <div
                  className="text-xs px-3 py-2 rounded-[var(--radius-sm)] mb-2.5"
                  style={{
                    background: "var(--red-bg)",
                    border: "1px solid var(--red-border)",
                    color: "var(--red-fg)",
                  }}
                >
                  {suggestMut.error.message}
                </div>
              )}

              {suggestion && (
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
                      Suggested refinement
                    </strong>
                  </div>
                  <div style={{ color: "var(--fg-muted)" }}>
                    {suggestion.reasoning ||
                      "(model returned no rationale — review the diff before applying.)"}
                  </div>
                  <details className="mt-2">
                    <summary
                      className="cursor-pointer text-xs"
                      style={{ color: "var(--accent)" }}
                    >
                      View suggested prompt
                    </summary>
                    <pre
                      className="text-xs mt-1.5 p-2 whitespace-pre-wrap"
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        maxHeight: 240,
                        overflow: "auto",
                      }}
                    >
                      {suggestion.suggested_prompt}
                    </pre>
                  </details>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setPrompt(suggestion.suggested_prompt)}
                    >
                      Apply to prompt
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => suggestMut.reset()}
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

          {/* EXAMPLES TAB */}
          {tab === "examples" && (
            <ExamplesTabBody
              activeExamples={activeExamples}
              isLoading={examplesQ.isLoading}
              parentIterationId={parentIterationId}
              fromVersion={fromVersion}
              onOpenModal={() => setShowExamplesModal(true)}
            />
          )}
        </div>
      )}

      {showExamplesModal && (
        <SelectExamplesModal
          projectId={projectId}
          criterionId={row.id}
          criterionName={row.name}
          parentIterationId={parentIterationId}
          onClose={() => setShowExamplesModal(false)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //
// Examples tab body — compact active-set display + modal trigger
// ------------------------------------------------------------------ //

function ExamplesTabBody({
  activeExamples,
  isLoading,
  parentIterationId,
  fromVersion,
  onOpenModal,
}: {
  activeExamples: CalibrationExampleItem[];
  isLoading: boolean;
  parentIterationId: number | null;
  fromVersion: number;
  onOpenModal: () => void;
}) {
  if (parentIterationId == null) {
    return (
      <div
        className="text-xs italic px-2 py-3"
        style={{ color: "var(--fg-muted)" }}
      >
        Calibration examples come from v(N)'s scored disagreements and
        agreements. Create v1 first and score it on dev; then come back to
        pick examples for v2.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
        Loading examples…
      </div>
    );
  }
  if (activeExamples.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
          No active calibration examples for this criterion. Pick a few
          disagreements (where v{fromVersion} was wrong) or agreements
          (where v{fromVersion} got it right) to anchor v(N+1)'s prompt.
        </div>
        <button
          className="btn btn-primary"
          style={{ alignSelf: "flex-start" }}
          onClick={onOpenModal}
        >
          <Plus className="w-3 h-3" /> Select examples
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <div
        className="text-xs"
        style={{ color: "var(--fg-muted)" }}
      >
        {activeExamples.length} active example
        {activeExamples.length === 1 ? "" : "s"} will be injected into the
        prompt at scoring time.
      </div>
      <div
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
        }}
      >
        <table className="table">
          <thead>
            <tr>
              <th>Application</th>
              <th>Source</th>
              <th>Human score</th>
            </tr>
          </thead>
          <tbody>
            {activeExamples.map((ex) => (
              <tr key={ex.id}>
                <td className="font-mono text-xs">
                  {ex.application_external_id}
                </td>
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
                  {ex.human_score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="btn"
        style={{ alignSelf: "flex-start" }}
        onClick={onOpenModal}
      >
        Manage examples
      </button>
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
