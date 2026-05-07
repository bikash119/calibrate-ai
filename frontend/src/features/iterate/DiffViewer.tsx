/**
 * Per-criterion unified diff between the active iteration and an earlier version.
 *
 * Backend's diff endpoint only returns criteria whose prompts differ — so an
 * empty `per_criterion` array means "no changes from the chosen baseline."
 */

import { useMemo } from "react";

import { Card } from "../../components/ui/Card";
import { useDiff } from "../../hooks/useIterations";
import type { DiffLineItem, IterationItem } from "../../schemas";

interface Props {
  projectId: number;
  /** Currently-viewed iteration. */
  toVersion: number;
  /** All iterations in the project so we can populate the picker. */
  iterations: IterationItem[];
  /** Currently-selected "from" version. Caller controls; we only display. */
  fromVersion: number | null;
  onFromVersionChange: (v: number | null) => void;
}

export function DiffViewer({
  projectId,
  toVersion,
  iterations,
  fromVersion,
  onFromVersionChange,
}: Props) {
  const olderVersions = useMemo(
    () => iterations.filter((it) => it.version < toVersion).map((it) => it.version).sort((a, b) => b - a),
    [iterations, toVersion],
  );

  const diff = useDiff(projectId, fromVersion ?? undefined, toVersion);

  return (
    <Card
      title="Diff"
      desc={`Compare v${toVersion} against an earlier version. Only criteria with changed prompts are shown.`}
      action={
        <select
          value={fromVersion ?? ""}
          onChange={(e) =>
            onFromVersionChange(e.target.value ? Number(e.target.value) : null)
          }
          className="px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)]"
        >
          <option value="">Select base version…</option>
          {olderVersions.map((v) => (
            <option key={v} value={v}>
              v{v} → v{toVersion}
            </option>
          ))}
        </select>
      }
    >
      {olderVersions.length === 0 && (
        <div className="text-sm text-[var(--fg-muted)]">
          No earlier versions to diff against.
        </div>
      )}

      {olderVersions.length > 0 && fromVersion == null && (
        <div className="text-sm text-[var(--fg-muted)]">
          Pick an earlier version to compare.
        </div>
      )}

      {diff.isLoading && (
        <div className="text-sm text-[var(--fg-muted)]">Loading diff…</div>
      )}

      {diff.data && diff.data.per_criterion.length === 0 && (
        <div className="text-sm text-[var(--fg-muted)]">
          No prompt changes between v{fromVersion} and v{toVersion}.
        </div>
      )}

      {diff.data && diff.data.per_criterion.length > 0 && (
        <div className="grid gap-3">
          {diff.data.per_criterion.map((c) => (
            <div
              key={c.criterion_id}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden"
            >
              <div className="px-3 py-1.5 text-xs font-mono bg-[var(--bg-sunken)] border-b border-[var(--border)]">
                {c.criterion_name}
              </div>
              <pre className="px-3 py-2 text-xs font-[var(--font-mono)] whitespace-pre-wrap max-h-72 overflow-y-auto">
                {c.lines.map((l, i) => (
                  <DiffLine key={i} line={l} />
                ))}
              </pre>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DiffLine({ line }: { line: DiffLineItem }) {
  if (line.type === "add") {
    return (
      <span className="block bg-[var(--green-bg)] text-[var(--green-fg)]">
        + {line.text}
      </span>
    );
  }
  if (line.type === "rm") {
    return (
      <span className="block bg-[var(--red-bg)] text-[var(--red-fg)]">
        − {line.text}
      </span>
    );
  }
  return <span className="block text-[var(--fg-muted)]">{"  "}{line.text}</span>;
}
