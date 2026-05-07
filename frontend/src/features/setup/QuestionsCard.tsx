import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Card } from "../../components/ui/Card";
import { useQuestions, useSaveQuestions } from "../../hooks/useDataset";
import type { QuestionInput } from "../../schemas";

interface Props {
  projectId: number;
  disabled?: boolean;
}

export function QuestionsCard({ projectId, disabled }: Props) {
  const { data, isLoading } = useQuestions(projectId);
  const save = useSaveQuestions(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<QuestionInput[]>([]);

  // Snapshot data into the draft when the user clicks Edit. We re-seed each
  // time edit mode opens, so the operator always starts from server state.
  const startEdit = () => {
    if (data) {
      setDraft(
        data.questions.map((q) => ({
          key: q.key,
          text: q.text,
          sort_order: q.sort_order,
        })),
      );
    } else {
      setDraft([]);
    }
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    save.reset();
  };

  const handleSave = async () => {
    // Re-index sort_order so the saved list matches display order
    const ordered = draft.map((q, i) => ({ ...q, sort_order: i }));
    try {
      await save.mutateAsync(ordered);
      setEditing(false);
    } catch {
      // error message is rendered below from save.error
    }
  };

  const updateRow = (i: number, patch: Partial<QuestionInput>) =>
    setDraft((d) => d.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const addRow = () =>
    setDraft((d) => [...d, { key: "", text: "", sort_order: d.length }]);
  const removeRow = (i: number) =>
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
      title="Questions"
      desc="The dataset's question schema. Each question has a stable key (used in answers and rubric criteria) and human-readable text."
      action={action}
    >
      {isLoading && <div className="text-sm text-[var(--fg-muted)]">Loading…</div>}

      {!isLoading && !editing && data && data.questions.length === 0 && (
        <div className="text-sm text-[var(--fg-muted)]">
          No questions yet. Click <em>Edit</em> to add some.
        </div>
      )}

      {!isLoading && !editing && data && data.questions.length > 0 && (
        <div className="grid gap-1.5">
          {data.questions.map((q) => (
            <div
              key={q.id}
              className="flex items-start gap-3 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)]"
            >
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--bg-sunken)] shrink-0 mt-0.5">
                {q.key}
              </span>
              <span className="text-sm">{q.text}</span>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="grid gap-2">
          {draft.map((q, i) => (
            <div
              key={i}
              className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)]"
            >
              <input
                value={q.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="key"
                className="w-32 px-2 py-1 text-xs font-mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
              />
              <input
                value={q.text}
                onChange={(e) => updateRow(i, { text: e.target.value })}
                placeholder="Question text"
                className="flex-1 px-2 py-1 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                className="btn btn-ghost btn-sm shrink-0"
                onClick={() => removeRow(i)}
                title="Remove question"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button className="btn btn-sm self-start" onClick={addRow}>
            <Plus className="w-3 h-3" /> Add question
          </button>
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
