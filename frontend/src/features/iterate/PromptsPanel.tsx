/**
 * Per-criterion prompt viewer + editor. Iterations are immutable on the
 * backend, so saving edits creates a NEW iteration with the modified prompts.
 */

import { useEffect, useState } from "react";
import { Pencil, Save, X } from "lucide-react";

import { Card } from "../../components/ui/Card";
import type { IterationDetailResponse, CriterionPromptInput } from "../../schemas";

interface Props {
  iteration: IterationDetailResponse;
  onSave: (
    prompts: CriterionPromptInput[],
    note: string | null,
  ) => Promise<void>;
  saving: boolean;
  error: string | null;
  disabled?: boolean;
}

interface Draft {
  prompts: Map<number, string>;     // criterion_id → system_prompt
  note: string;
}

export function PromptsPanel({ iteration, onSave, saving, error, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ prompts: new Map(), note: "" });

  // Reset draft whenever the active iteration changes or we enter edit mode.
  useEffect(() => {
    if (!editing) return;
    const map = new Map<number, string>();
    for (const p of iteration.prompts) map.set(p.criterion_id, p.system_prompt);
    setDraft({ prompts: map, note: `Edit of v${iteration.version}` });
  }, [editing, iteration.id, iteration.version, iteration.prompts]);

  const startEdit = () => setEditing(true);
  const cancel = () => setEditing(false);

  const handleSave = async () => {
    const prompts: CriterionPromptInput[] = iteration.prompts.map((p) => ({
      criterion_id: p.criterion_id,
      system_prompt: draft.prompts.get(p.criterion_id) ?? p.system_prompt,
    }));
    try {
      await onSave(prompts, draft.note.trim() || null);
      setEditing(false);
    } catch {
      // surfaced inline below
    }
  };

  const updatePrompt = (criterionId: number, text: string) =>
    setDraft((d) => {
      const m = new Map(d.prompts);
      m.set(criterionId, text);
      return { ...d, prompts: m };
    });

  const action = editing ? (
    <div className="flex gap-2">
      <button className="btn btn-sm" onClick={cancel} disabled={saving}>
        <X className="w-3 h-3" /> Cancel
      </button>
      <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
        <Save className="w-3 h-3" />
        {saving ? "Saving…" : "Save as new version"}
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
      title={`v${iteration.version} prompts`}
      desc={
        editing
          ? "Saving creates a new iteration. The current one is left untouched."
          : iteration.note ?? "Per-criterion system prompts. Click edit to fork into a new version."
      }
      action={action}
    >
      {editing && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-[var(--fg-muted)] mb-1">
            Version note
          </label>
          <input
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="What changed?"
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}

      <div className="grid gap-3">
        {iteration.prompts.map((p) => (
          <div
            key={p.criterion_id}
            className="px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border)]"
          >
            <div className="text-xs font-mono text-[var(--fg-muted)] mb-1.5">
              {p.criterion_name}
            </div>
            {editing ? (
              <textarea
                value={draft.prompts.get(p.criterion_id) ?? p.system_prompt}
                onChange={(e) => updatePrompt(p.criterion_id, e.target.value)}
                rows={12}
                className="w-full px-2 py-1.5 text-xs font-[var(--font-mono)] rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                spellCheck={false}
              />
            ) : (
              <pre className="text-xs font-[var(--font-mono)] whitespace-pre-wrap text-[var(--fg-muted)] max-h-72 overflow-y-auto">
                {p.system_prompt}
              </pre>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {error}
        </div>
      )}
    </Card>
  );
}
