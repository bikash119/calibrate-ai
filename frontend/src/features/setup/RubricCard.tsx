import { useEffect, useMemo, useState } from "react";   // useEffect kept for CriterionEditor's anchor pruning
import {
  Edit2,
  ListChecks,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import { useQuestions } from "../../hooks/useDataset";
import {
  useExtractRubricFile,
  useExtractRubricText,
  useRubric,
  useSaveRubric,
} from "../../hooks/useRubric";
import type { CriterionInput, CriterionItem, QuestionItem } from "../../schemas";

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
  const [draft, setDraft] = useState<CriterionInput[]>([]);
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

  const acceptExtraction = (criteria: CriterionInput[]) => {
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
    const ordered = draft.map((c, i) => ({ ...c, sort_order: i }));
    try {
      await save.mutateAsync({ criteria: ordered });
      setEditing(false);
    } catch {
      // shown inline below
    }
  };

  const update = (i: number, patch: Partial<CriterionInput>) =>
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
            <CriterionReadView key={c.id} criterion={c} />
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

function CriterionReadView({ criterion }: { criterion: CriterionItem }) {
  const range = useMemo(
    () =>
      Array.from(
        { length: criterion.scale_max - criterion.scale_min + 1 },
        (_, i) => criterion.scale_min + i,
      ),
    [criterion.scale_min, criterion.scale_max],
  );

  return (
    <div className="px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border)]">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-semibold">{criterion.name}</span>
        <span className="text-xs text-[var(--fg-muted)]">
          scale {criterion.scale_min}–{criterion.scale_max}
        </span>
      </div>
      <div className="text-xs text-[var(--fg-muted)] mb-2">{criterion.description}</div>

      <div className="grid gap-1 mb-2">
        {range.map((s) => (
          <div key={s} className="text-xs flex gap-2">
            <span className="font-mono text-[var(--fg-faint)] shrink-0">{s}</span>
            <span>{criterion.anchor_descriptions[String(s)] || <em>(missing)</em>}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {criterion.feeding_question_keys.map((k) => (
          <span
            key={k}
            className={`font-mono px-1.5 py-0.5 rounded ${
              criterion.weighted_question_keys.includes(k)
                ? "bg-[var(--accent-bg)] border border-[var(--accent-border)] text-[var(--accent)]"
                : "bg-[var(--bg-sunken)]"
            }`}
            title={
              criterion.weighted_question_keys.includes(k)
                ? "Feeding (high weight)"
                : "Feeding"
            }
          >
            {k}
          </span>
        ))}
      </div>
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
  criterion: CriterionInput;
  questions: QuestionItem[];
  onChange: (patch: Partial<CriterionInput>) => void;
  onRemove: () => void;
}) {
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

  const toggleFeeding = (k: string) => {
    const next = isFeeding(k)
      ? criterion.feeding_question_keys.filter((x) => x !== k)
      : [...criterion.feeding_question_keys, k];
    // dropping from feeding also drops from weighted
    const weighted = next.includes(k)
      ? criterion.weighted_question_keys
      : criterion.weighted_question_keys.filter((x) => x !== k);
    onChange({ feeding_question_keys: next, weighted_question_keys: weighted });
  };
  const toggleWeighted = (k: string) => {
    if (!isFeeding(k)) return;
    const next = isWeighted(k)
      ? criterion.weighted_question_keys.filter((x) => x !== k)
      : [...criterion.weighted_question_keys, k];
    onChange({ weighted_question_keys: next });
  };

  return (
    <div className="px-3 py-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] grid gap-2.5">
      <div className="flex gap-2 items-start">
        <input
          value={criterion.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="snake_case_name"
          className="flex-1 px-2 py-1 text-sm font-mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          className="btn btn-ghost btn-sm shrink-0"
          onClick={onRemove}
          title="Remove criterion"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <textarea
        value={criterion.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="What does this criterion evaluate?"
        rows={2}
        className="w-full px-2 py-1.5 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
      />

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
        <div className="text-xs font-medium text-[var(--fg-muted)]">Anchor descriptions</div>
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

      <div className="grid gap-1.5">
        <div className="text-xs font-medium text-[var(--fg-muted)]">
          Feeding questions
          <span className="ml-1.5 text-[var(--fg-faint)]">(check to include; star = high weight)</span>
        </div>
        {questions.length === 0 && (
          <div className="text-xs text-[var(--fg-muted)] italic">
            No questions defined yet.
          </div>
        )}
        <div className="grid gap-1">
          {questions.map((q) => (
            <div key={q.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isFeeding(q.key)}
                onChange={() => toggleFeeding(q.key)}
              />
              <span className="font-mono w-24 truncate">{q.key}</span>
              <span className="flex-1 truncate text-[var(--fg-muted)]">{q.text}</span>
              <label
                className={`flex items-center gap-1 text-[var(--fg-faint)] ${
                  isFeeding(q.key) ? "" : "opacity-30"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isWeighted(q.key)}
                  disabled={!isFeeding(q.key)}
                  onChange={() => toggleWeighted(q.key)}
                />
                ★
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //

function toInput(c: CriterionItem): CriterionInput {
  return {
    name: c.name,
    description: c.description,
    scale_min: c.scale_min,
    scale_max: c.scale_max,
    anchor_descriptions: { ...c.anchor_descriptions },
    feeding_question_keys: [...c.feeding_question_keys],
    weighted_question_keys: [...c.weighted_question_keys],
    sort_order: c.sort_order,
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
