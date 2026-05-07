import { Link } from "react-router-dom";
import { Layers } from "lucide-react";

import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import { useLockedPrompts } from "../hooks/useLockedPrompts";

export function LockedPromptsLibrary() {
  const lockedPrompts = useLockedPrompts();
  const items = lockedPrompts.data?.locked_prompts ?? [];

  return (
    <div>
      <PageHead
        eyebrow="Workspace"
        title="Locked prompts"
        lede="Immutable artifacts produced by completed calibrations. Each entry snapshots its rubric, prompts, examples, and test metrics."
      />

      {lockedPrompts.isLoading && (
        <Card>
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        </Card>
      )}

      {lockedPrompts.error && (
        <Card>
          <div className="text-sm text-[var(--red-fg)]">{lockedPrompts.error.message}</div>
        </Card>
      )}

      {!lockedPrompts.isLoading && items.length === 0 && (
        <Card title="No locked prompts yet">
          <p className="text-sm text-[var(--fg-muted)] mb-2">
            Locked prompts appear here when a project completes its test phase
            and the operator clicks Lock.
          </p>
          <p className="text-sm text-[var(--fg-muted)]">
            Open a project, walk through Setup → Baseline → Iterate → Test, then
            lock the calibration.
          </p>
        </Card>
      )}

      {items.length > 0 && (
        <Card noPad>
          <div className="grid divide-y divide-[var(--border)]">
            {items.map((lp) => (
              <Link
                key={lp.id}
                to={`/locked-prompts/${lp.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-sunken)] transition-colors"
              >
                <Layers className="w-4 h-4 text-[var(--fg-faint)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{lp.name}</div>
                  <div className="text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums]">
                    {lp.provider}/{lp.model} ·{" "}
                    <span className="font-mono">{lp.prompt_hash.slice(0, 12)}</span>
                  </div>
                </div>
                <div className="text-xs text-[var(--fg-faint)] shrink-0">
                  {lp.locked_at ? new Date(lp.locked_at).toLocaleDateString() : "—"}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
