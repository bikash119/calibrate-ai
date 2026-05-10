import { useEffect, useMemo, useState } from "react";   // useEffect kept for CriterionEditor's anchor pruning
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit2,
  Eye,
  ListChecks,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { useApplications, useQuestions } from "../../hooks/useDataset";
import {
  useExtractRubricFile,
  useExtractRubricText,
  usePromptPreview,
  useRubric,
  useSaveRubric,
} from "../../hooks/useRubric";
import type {
  CriterionInput,
  CriterionItem,
  ExtractedCriterion,
  QuestionItem,
} from "../../schemas";

interface Props {
  projectId: number;
  disabled?: boolean;
}

type EditMode = "file" | "paste" | "manual";

export function RubricCard({ projectId, disabled }: Props) {
  const rubric = useRubric(projectId);
  const questions = useQuestions(projectId);
  const save = useSaveRubric(projectId);
  const extractText = useExtractRubricText(projectId);
  const extractFile = useExtractRubricFile(projectId);

  const [editing, setEditing] = useState(false);
  // Draft uses the extraction shape so unbound refs travel with each
  // criterion until save. Manually-added rows just have empty arrays.
  const [draft, setDraft] = useState<ExtractedCriterion[]>([]);
  const [mode, setMode] = useState<EditMode>("manual");
  const [extractedCount, setExtractedCount] = useState(0);

  const startEdit = () => {
    const existing = rubric.data ? rubric.data.criteria.map(toInput) : [];
    setDraft(existing);
    // First-time edits start in upload mode; subsequent edits start in manual.
    setMode(existing.length > 0 ? "manual" : "file");
    setExtractedCount(0);
    extractText.reset();
    extractFile.reset();
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setExtractedCount(0);
    save.reset();
    extractText.reset();
    extractFile.reset();
  };

  const acceptExtraction = (criteria: ExtractedCriterion[]) => {
    setDraft(criteria);
    setExtractedCount(criteria.length);
    setMode("manual");
  };

  const handlePasteExtract = async (text: string) => {
    try {
      const r = await extractText.mutateAsync(text);
      acceptExtraction(r.criteria);
    } catch {
      /* surfaced inline */
    }
  };

  const handleFileExtract = async (file: File) => {
    try {
      const r = await extractFile.mutateAsync(file);
      acceptExtraction(r.criteria);
    } catch {
      /* surfaced inline */
    }
  };

  const handleSave = async () => {
    // Strip extraction-only diagnostics before save.
    const ordered: CriterionInput[] = draft.map((c, i) => {
      const { unbound_feeding_refs: _f, unbound_weighted_refs: _w, ...rest } = c;
      return { ...rest, sort_order: i };
    });
    try {
      await save.mutateAsync({ criteria: ordered });
      setEditing(false);
    } catch {
      // shown inline below
    }
  };

  const update = (i: number, patch: Partial<ExtractedCriterion>) =>
    setDraft((d) => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const add = () =>
    setDraft((d) => [
      ...d,
      {
        name: "",
        description: "",
        scale_min: 1,
        scale_max: 5,
        anchor_descriptions: {},
        feeding_question_keys: [],
        weighted_question_keys: [],
        sort_order: d.length,
        unbound_feeding_refs: [],
        unbound_weighted_refs: [],
      },
    ]);

  const remove = (i: number) =>
    setDraft((d) => d.filter((_, idx) => idx !== i));

  const action = editing ? (
    <div className="flex gap-2">
      <button className="btn btn-sm" onClick={cancel} disabled={save.isPending}>
        Cancel
      </button>
      <button
        className="btn btn-primary btn-sm"
        onClick={handleSave}
        disabled={save.isPending}
      >
        {save.isPending ? "Saving…" : "Save"}
      </button>
    </div>
  ) : (
    !disabled && (
      <button className="btn btn-sm" onClick={startEdit}>
        <Pencil className="w-3 h-3" /> Edit
      </button>
    )
  );

  return (
    <Card
      title="Rubric"
      desc="One criterion per row, with its own scale and anchor descriptions. Feeding questions are the answers the LLM will see when scoring this criterion."
      action={action}
    >
      {rubric.isLoading && <div className="text-sm text-[var(--fg-muted)]">Loading…</div>}

      {!rubric.isLoading && !editing && rubric.data && rubric.data.criteria.length === 0 && (
        <div className="text-sm text-[var(--fg-muted)]">
          No criteria yet. Click <em>Edit</em> to define the rubric.
        </div>
      )}

      {!rubric.isLoading && !editing && rubric.data && rubric.data.criteria.length > 0 && (
        <div className="grid gap-2">
          {rubric.data.criteria.map((c) => (
            <CriterionReadView
              key={c.id}
              projectId={projectId}
              criterion={c}
              questions={questions.data?.questions ?? []}
            />
          ))}
        </div>
      )}

      {editing && (
        <div className="grid gap-3">
          {/* Mode tab strip — only while draft is empty. Once criteria exist
              (extracted or manually added), the form is the only thing that
              makes sense, and switching modes would silently discard work. */}
          {draft.length === 0 && <ModeTabs current={mode} onChange={setMode} />}

          {(questions.data?.questions.length ?? 0) === 0 && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--yellow-bg)] border border-[var(--yellow-border)] text-[var(--yellow-fg)]">
              Add questions first — criteria reference question keys.
            </div>
          )}

          {mode === "file" && draft.length === 0 && (
            <RubricFileMode
              onPick={handleFileExtract}
              loading={extractFile.isPending}
              error={extractFile.error?.message ?? null}
            />
          )}

          {mode === "paste" && draft.length === 0 && (
            <RubricPasteMode
              onExtract={handlePasteExtract}
              loading={extractText.isPending}
              error={extractText.error?.message ?? null}
            />
          )}

          {/* If extraction populated draft, OR mode is manual, OR draft already has data,
              show the structured form. */}
          {(mode === "manual" || draft.length > 0) && (
            <>
              {extractedCount > 0 && (
                <Banner kind="success" title={`Extracted ${extractedCount} criteria`}>
                  Review the structured form below — this is what the LLM will see
                  during scoring. Edit anything that looks off, then Save.
                </Banner>
              )}
              {draft.map((c, i) => (
                <CriterionEditor
                  key={i}
                  criterion={c}
                  questions={questions.data?.questions ?? []}
                  onChange={(patch) => update(i, patch)}
                  onRemove={() => remove(i)}
                />
              ))}
              <button className="btn btn-sm self-start" onClick={add}>
                <Plus className="w-3 h-3" /> Add criterion
              </button>
            </>
          )}

          {save.error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {save.error.message}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ //
// Read-only criterion display                                         //
// ------------------------------------------------------------------ //

function CriterionReadView({
  projectId,
  criterion,
  questions,
}: {
  projectId: number;
  criterion: CriterionItem;
  questions: QuestionItem[];
}) {
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const range = useMemo(
    () =>
      Array.from(
        { length: criterion.scale_max - criterion.scale_min + 1 },
        (_, i) => criterion.scale_min + i,
      ),
    [criterion.scale_min, criterion.scale_max],
  );

  const summary = formatSummary(criterion, questions);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 grow min-w-0 text-left"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--fg-faint)] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-faint)] shrink-0" />
          )}
          <div className="grow min-w-0">
            <div className="text-sm font-medium truncate">{criterion.name}</div>
            <div className="text-xs text-[var(--fg-muted)] truncate">{summary}</div>
          </div>
        </button>
        <button
          className="btn btn-sm btn-ghost shrink-0"
          onClick={() => setPreviewOpen(true)}
          title="See the prompt the LLM will receive when scoring this criterion"
        >
          <Eye className="w-3 h-3" /> Show prompt
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3 pl-9 grid gap-2.5">
          <div className="text-xs text-[var(--fg-muted)]">{criterion.description}</div>
          <div className="grid gap-1">
            {range.map((s) => (
              <div key={s} className="text-xs flex gap-2">
                <span className="font-mono text-[var(--fg-faint)] shrink-0 w-5 text-right">
                  {s}
                </span>
                <span>{criterion.anchor_descriptions[String(s)] || <em>(missing)</em>}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <PromptPreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        projectId={projectId}
        criterion={criterion}
      />
    </div>
  );
}

// ------------------------------------------------------------------ //
// Prompt preview dialog — read-only debug view. Renders system + user
// prompt the same way real scoring would.
// ------------------------------------------------------------------ //

function PromptPreviewDialog({
  open,
  onClose,
  projectId,
  criterion,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  criterion: CriterionItem;
}) {
  const apps = useApplications(projectId);
  const [appId, setAppId] = useState<number | undefined>(undefined);

  // Reset app selection whenever the dialog opens.
  useEffect(() => {
    if (open) setAppId(undefined);
  }, [open, criterion.id]);

  const preview = usePromptPreview(projectId, criterion.id, appId, open);

  if (!open) return null;

  const applications = apps.data?.applications ?? [];

  return (
    <Modal open={open} onClose={onClose} width={900}>
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
        <div className="grow min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            Prompt preview · {criterion.name}
          </h3>
          <p className="text-xs text-[var(--fg-muted)] mt-0.5">
            This is the exact prompt the LLM will see when scoring this criterion.
            To change it, edit the rubric and re-save.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2 text-xs">
        <span className="text-[var(--fg-muted)]">Application:</span>
        {applications.length > 0 ? (
          <select
            className="px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-xs"
            value={appId ?? ""}
            onChange={(e) =>
              setAppId(e.target.value ? Number(e.target.value) : undefined)
            }
          >
            <option value="">{`First (${applications[0].external_id})`}</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.external_id}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[var(--fg-faint)] italic">
            No applications imported yet — only system prompt will render.
          </span>
        )}
      </div>

      <div className="px-5 py-4 max-h-[70vh] overflow-y-auto grid gap-4">
        {preview.isLoading && (
          <div className="text-sm text-[var(--fg-muted)]">Rendering…</div>
        )}
        {preview.error && (
          <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
            {preview.error.message}
          </div>
        )}
        {preview.data && (
          <>
            <PromptBlock title="System prompt" text={preview.data.system_prompt} />
            {preview.data.user_prompt ? (
              <PromptBlock title="User prompt" text={preview.data.user_prompt} />
            ) : (
              <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--bg-sunken)] text-[var(--fg-muted)]">
                User prompt requires at least one imported application.
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable in some contexts; ignore */
    }
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-[var(--fg-muted)]">{title}</div>
        <button className="btn btn-ghost btn-sm" onClick={onCopy} title="Copy to clipboard">
          <Copy className="w-3 h-3" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-xs whitespace-pre-wrap break-words font-mono bg-[var(--bg-sunken)] border border-[var(--border)] rounded-[var(--radius-sm)] p-3 leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Editable criterion row                                              //
// ------------------------------------------------------------------ //

function CriterionEditor({
  criterion,
  questions,
  onChange,
  onRemove,
}: {
  criterion: ExtractedCriterion;
  questions: QuestionItem[];
  onChange: (patch: Partial<ExtractedCriterion>) => void;
  onRemove: () => void;
}) {
  // Newly-extracted/added rows expand by default so the operator sees the
  // editable form without an extra click. Clicking the header toggles.
  const [open, setOpen] = useState(true);

  const range = useMemo(
    () =>
      Array.from(
        { length: criterion.scale_max - criterion.scale_min + 1 },
        (_, i) => criterion.scale_min + i,
      ),
    [criterion.scale_min, criterion.scale_max],
  );

  // When scale changes, prune anchor entries outside [min, max]
  useEffect(() => {
    const allowed = new Set(range.map(String));
    const pruned: Record<string, string> = {};
    for (const [k, v] of Object.entries(criterion.anchor_descriptions)) {
      if (allowed.has(k)) pruned[k] = v;
    }
    if (Object.keys(pruned).length !== Object.keys(criterion.anchor_descriptions).length) {
      onChange({ anchor_descriptions: pruned });
    }
    // run only when the range changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criterion.scale_min, criterion.scale_max]);

  const isFeeding = (k: string) => criterion.feeding_question_keys.includes(k);
  const isWeighted = (k: string) => criterion.weighted_question_keys.includes(k);

  const removeFeeding = (k: string) => {
    onChange({
      feeding_question_keys: criterion.feeding_question_keys.filter((x) => x !== k),
      weighted_question_keys: criterion.weighted_question_keys.filter((x) => x !== k),
    });
  };
  const addFeeding = (k: string) => {
    if (!k || isFeeding(k)) return;
    onChange({ feeding_question_keys: [...criterion.feeding_question_keys, k] });
  };
  const toggleWeighted = (k: string) => {
    if (!isFeeding(k)) return;
    const next = isWeighted(k)
      ? criterion.weighted_question_keys.filter((x) => x !== k)
      : [...criterion.weighted_question_keys, k];
    onChange({ weighted_question_keys: next });
  };

  const summary = formatSummary(criterion, questions);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 grow min-w-0 text-left"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--fg-faint)] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-faint)] shrink-0" />
          )}
          <div className="grow min-w-0">
            <div className="text-sm font-medium truncate">
              {criterion.name || <em className="text-[var(--fg-faint)]">(unnamed criterion)</em>}
            </div>
            {!open && (
              <div className="text-xs text-[var(--fg-muted)] truncate">{summary}</div>
            )}
          </div>
        </button>
        <button
          className="btn btn-ghost btn-sm shrink-0"
          onClick={onRemove}
          title="Remove criterion"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 pl-9 grid gap-2.5">
          <input
            value={criterion.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="snake_case_name"
            className="px-2 py-1 text-sm font-mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
          />

          <div className="grid gap-1">
            <label className="text-xs font-medium text-[var(--fg-muted)]">
              Description
              <span className="ml-1.5 text-[var(--fg-faint)] font-normal">
                (this exact text is shown to the LLM)
              </span>
            </label>
            <textarea
              value={criterion.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="What does this criterion evaluate?"
              rows={2}
              className="w-full px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--fg-muted)]">Scale min</span>
              <input
                type="number"
                value={criterion.scale_min}
                onChange={(e) =>
                  onChange({ scale_min: Number(e.target.value) || criterion.scale_min })
                }
                className="w-14 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] [font-variant-numeric:tabular-nums]"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--fg-muted)]">max</span>
              <input
                type="number"
                value={criterion.scale_max}
                onChange={(e) =>
                  onChange({ scale_max: Number(e.target.value) || criterion.scale_max })
                }
                className="w-14 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] [font-variant-numeric:tabular-nums]"
              />
            </label>
          </div>

          <div className="grid gap-1.5">
            <div className="text-xs font-medium text-[var(--fg-muted)]">Score anchors</div>
            {range.map((s) => (
              <div key={s} className="flex items-start gap-2">
                <span className="text-xs font-mono text-[var(--fg-faint)] mt-1.5 shrink-0 w-6 text-right">
                  {s}
                </span>
                <input
                  value={criterion.anchor_descriptions[String(s)] ?? ""}
                  onChange={(e) =>
                    onChange({
                      anchor_descriptions: {
                        ...criterion.anchor_descriptions,
                        [String(s)]: e.target.value,
                      },
                    })
                  }
                  placeholder={`What earns a ${s}?`}
                  className="flex-1 px-2 py-1 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            ))}
          </div>

          <UnboundRefsNotice
            unboundFeeding={criterion.unbound_feeding_refs ?? []}
            unboundWeighted={criterion.unbound_weighted_refs ?? []}
            onDismiss={() =>
              onChange({ unbound_feeding_refs: [], unbound_weighted_refs: [] })
            }
          />

          <FeedingColumnPicker
            questions={questions}
            selected={criterion.feeding_question_keys}
            isFeeding={isFeeding}
            isWeighted={isWeighted}
            onAdd={addFeeding}
            onRemove={removeFeeding}
            onToggleWeighted={toggleWeighted}
          />
        </div>
      )}
    </div>
  );
}

function FeedingColumnPicker({
  questions,
  selected,
  isFeeding,
  isWeighted,
  onAdd,
  onRemove,
  onToggleWeighted,
}: {
  questions: QuestionItem[];
  selected: string[];
  isFeeding: (k: string) => boolean;
  isWeighted: (k: string) => boolean;
  onAdd: (k: string) => void;
  onRemove: (k: string) => void;
  onToggleWeighted: (k: string) => void;
}) {
  const byKey = useMemo(() => {
    const m = new Map<string, QuestionItem>();
    for (const q of questions) m.set(q.key, q);
    return m;
  }, [questions]);

  const unselected = useMemo(
    () => questions.filter((q) => !isFeeding(q.key)),
    [questions, isFeeding],
  );

  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium text-[var(--fg-muted)]">
        Feeds from columns
        <span className="ml-1.5 text-[var(--fg-faint)] font-normal">
          (click ★ to mark as high weight)
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {selected.length === 0 && (
          <span className="text-xs text-[var(--fg-faint)] italic">
            No columns selected yet.
          </span>
        )}
        {selected.map((k) => {
          const q = byKey.get(k);
          const w = isWeighted(k);
          return (
            <span
              key={k}
              className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs border ${
                w
                  ? "bg-[var(--accent-bg)] border-[var(--accent-border)] text-[var(--accent)]"
                  : "bg-[var(--bg-sunken)] border-[var(--border)]"
              }`}
              title={q?.text ?? k}
            >
              <span className="font-mono [font-variant-numeric:tabular-nums]">
                {labelFor(q, k)}
              </span>
              <button
                type="button"
                onClick={() => onToggleWeighted(k)}
                className="p-0.5 rounded hover:bg-[var(--bg-elevated)]"
                title={w ? "Remove high-weight star" : "Mark as high weight"}
              >
                <Star
                  className="w-3 h-3"
                  fill={w ? "currentColor" : "none"}
                />
              </button>
              <button
                type="button"
                onClick={() => onRemove(k)}
                className="p-0.5 rounded hover:bg-[var(--bg-elevated)]"
                title="Remove from feeding"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        {unselected.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAdd(e.target.value);
              e.target.value = "";
            }}
            className="text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)]"
          >
            <option value="">+ Add column…</option>
            {unselected.map((q) => (
              <option key={q.key} value={q.key}>
                {labelFor(q, q.key)}
                {q.text ? ` — ${truncate(q.text, 60)}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function UnboundRefsNotice({
  unboundFeeding,
  unboundWeighted,
  onDismiss,
}: {
  unboundFeeding: string[];
  unboundWeighted: string[];
  onDismiss: () => void;
}) {
  if (unboundFeeding.length === 0 && unboundWeighted.length === 0) return null;
  const fmt = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");
  return (
    <div className="px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs bg-[var(--yellow-bg)] border border-[var(--yellow-border)] text-[var(--yellow-fg)] flex items-start justify-between gap-2">
      <div className="grid gap-0.5">
        {unboundFeeding.length > 0 && (
          <div>
            Rubric mentions {fmt(unboundFeeding)} but no column matched — add the right
            ones below.
          </div>
        )}
        {unboundWeighted.length > 0 && (
          <div>Could not match weighted refs: {fmt(unboundWeighted)}.</div>
        )}
      </div>
      <button
        className="btn btn-ghost btn-sm shrink-0"
        onClick={onDismiss}
        title="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Display helpers — hide the q-key abstraction from operators. The
// rubric uses spreadsheet column numbers; that's what we show.
// ------------------------------------------------------------------ //

function labelFor(q: QuestionItem | undefined, fallbackKey: string): string {
  if (q?.column_index != null) return `Col ${q.column_index + 1}`;
  return q?.key ?? fallbackKey;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function formatSummary(
  criterion: { scale_min: number; scale_max: number; feeding_question_keys: string[]; weighted_question_keys: string[] },
  questions: QuestionItem[],
): string {
  const byKey = new Map(questions.map((q) => [q.key, q] as const));
  const bare = (k: string) => {
    const q = byKey.get(k);
    if (q?.column_index != null) return String(q.column_index + 1);
    return q?.key ?? k;
  };
  const feeds = criterion.feeding_question_keys.map(bare);
  const weighted = criterion.weighted_question_keys.map(bare);
  const parts = [`Scale ${criterion.scale_min}–${criterion.scale_max}`];
  if (feeds.length) parts.push(`Feeds Col ${feeds.join(", ")}`);
  if (weighted.length) parts.push(`Col ${weighted.join(", ")} weighted`);
  return parts.join(" · ");
}

// ------------------------------------------------------------------ //

function toInput(c: CriterionItem): ExtractedCriterion {
  return {
    name: c.name,
    description: c.description,
    scale_min: c.scale_min,
    scale_max: c.scale_max,
    anchor_descriptions: { ...c.anchor_descriptions },
    feeding_question_keys: [...c.feeding_question_keys],
    weighted_question_keys: [...c.weighted_question_keys],
    sort_order: c.sort_order,
    unbound_feeding_refs: [],
    unbound_weighted_refs: [],
  };
}

// ------------------------------------------------------------------ //
// Edit-mode tabs                                                     //
// ------------------------------------------------------------------ //

function ModeTabs({
  current,
  onChange,
}: {
  current: EditMode;
  onChange: (m: EditMode) => void;
}) {
  const tabs: { id: EditMode; label: string; icon: React.ReactNode }[] = [
    { id: "file", label: "Upload file", icon: <Upload className="w-3 h-3" /> },
    { id: "paste", label: "Paste text", icon: <Edit2 className="w-3 h-3" /> },
    { id: "manual", label: "Manual entry", icon: <ListChecks className="w-3 h-3" /> },
  ];
  return (
    <div
      className="inline-flex items-center gap-1 p-1 rounded-[var(--radius-sm)]"
      style={{ background: "var(--bg-sunken)" }}
    >
      {tabs.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`btn btn-sm ${active ? "" : "btn-ghost"}`}
            style={
              active
                ? {
                    background: "var(--bg-elevated)",
                    boxShadow: "var(--shadow-sm)",
                  }
                : { background: "transparent", border: "none" }
            }
          >
            {t.icon} {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ //
// File upload mode                                                   //
// ------------------------------------------------------------------ //

function RubricFileMode({
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
      className={`px-4 py-7 rounded-[var(--radius-sm)] border-2 border-dashed text-center transition-colors ${
        dragging
          ? "border-[var(--accent)] bg-[var(--accent-bg)]"
          : "border-[var(--border)] bg-[var(--bg-sunken)]"
      }`}
    >
      <Upload className="w-5 h-5 text-[var(--fg-faint)] mx-auto mb-2" />
      <div className="text-sm font-medium mb-1">
        Drop a rubric file here, or click to browse
      </div>
      <div className="text-xs text-[var(--fg-muted)] mb-3">
        .txt, .md, .docx · max 10 MB · PDF support coming later
      </div>
      <label className="btn btn-sm inline-flex">
        <input
          type="file"
          accept=".txt,.md,.docx"
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
        <div className="text-xs text-[var(--fg-muted)] mt-3">
          Extracting structured form…
        </div>
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
// Paste-text mode                                                    //
// ------------------------------------------------------------------ //

function RubricPasteMode({
  onExtract,
  loading,
  error,
}: {
  onExtract: (text: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const [text, setText] = useState("");
  return (
    <div className="grid gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Paste rubric text here — criteria, scales, anchor descriptions, anything that defines what 'good' looks like for each dimension."
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--fg-faint)] [font-variant-numeric:tabular-nums]">
          {text.length} chars
        </span>
        <button
          className="btn btn-primary btn-sm"
          disabled={!text.trim() || loading}
          onClick={() => onExtract(text)}
        >
          <Sparkles className="w-3 h-3" />
          {loading ? "Extracting…" : "Extract structured form"}
        </button>
      </div>
      {error && (
        <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {error}
        </div>
      )}
    </div>
  );
}
