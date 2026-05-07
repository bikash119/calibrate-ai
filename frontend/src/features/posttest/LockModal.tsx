/**
 * Confirmation modal for locking a project.
 *
 * Lock is irreversible (well, it's reversible by cloning, but the artifact
 * is immutable). The modal asks for a name and shows what's about to be
 * snapshotted so the operator knows what they're committing to.
 */

import { useState } from "react";
import { Lock } from "lucide-react";

interface Props {
  iterationVersion: number;
  testQwk: number | null;
  hhBaselineQwk: number | null;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
  submitting: boolean;
  error: string | null;
}

export function LockModal({
  iterationVersion,
  testQwk,
  hhBaselineQwk,
  onClose,
  onConfirm,
  submitting,
  error,
}: Props) {
  const [name, setName] = useState(`v${iterationVersion}`);

  const canSubmit = name.trim().length > 0 && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-lg">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold tracking-tight">Lock prompt</h3>
          <p className="text-xs text-[var(--fg-muted)] mt-0.5">
            Snapshots the rubric, prompts, active calibration examples, and test
            metrics into an immutable artifact.
          </p>
        </div>

        <div className="px-5 py-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-[var(--fg-muted)]">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. acme-grant-v1.0"
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Stat label={`Iteration`} value={`v${iterationVersion}`} />
            <Stat
              label="Test QWK"
              value={testQwk != null ? testQwk.toFixed(3) : "—"}
              accent
            />
            <Stat
              label="H-H ceiling"
              value={hhBaselineQwk != null ? hhBaselineQwk.toFixed(3) : "—"}
            />
            <Stat label="Hash" value="(computed)" />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onConfirm(name.trim())}
          >
            <Lock className="w-3.5 h-3.5" />
            {submitting ? "Locking…" : "Lock prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)]">
      <div className="text-xs text-[var(--fg-muted)]">{label}</div>
      <div
        className={`text-base font-semibold [font-variant-numeric:tabular-nums] ${
          accent ? "text-[var(--accent)]" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
