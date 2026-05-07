import { useParams } from "react-router-dom";

import { Banner } from "../components/ui/Banner";
import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import { useAuditForEntity } from "../hooks/useAuditLog";
import { useProject } from "../hooks/useProjects";
import type { AuditEntryItem } from "../schemas";

export function ProjectHistoryPage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;
  const project = useProject(projectId);
  const audit = useAuditForEntity("project", projectId);

  if (!projectId) return null;

  if (project.error || !project.data) {
    return (
      <>
        <PageHead eyebrow="Project" title="History" />
        <Banner kind="danger" title="Project not found">
          {project.error?.message ?? "Project not accessible."}
        </Banner>
      </>
    );
  }

  const entries = audit.data?.entries ?? [];

  return (
    <div>
      <PageHead
        eyebrow={project.data.name}
        title="Project history"
        lede="Append-only log of project-level events. Drill into iterations or scoring jobs for finer-grained activity."
      />

      <Card>
        {audit.isLoading && (
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        )}
        {audit.error && (
          <div className="text-sm text-[var(--red-fg)]">{audit.error.message}</div>
        )}
        {!audit.isLoading && entries.length === 0 && (
          <div className="text-sm text-[var(--fg-muted)]">
            No events recorded yet for this project.
          </div>
        )}
        {entries.length > 0 && (
          <ol className="grid gap-2">
            {entries.map((e) => (
              <AuditEntryRow key={e.id} entry={e} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ //

function AuditEntryRow({ entry }: { entry: AuditEntryItem }) {
  const label = ACTION_LABELS[entry.action] ?? humanize(entry.action);
  const detailItems = formatDetails(entry.details);

  return (
    <li className="flex gap-3 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)]">
      <div className="text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums] w-24 shrink-0 mt-0.5">
        {entry.created_at ? formatTimestamp(entry.created_at) : "—"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium">{label}</span>
          {entry.user_username && (
            <span className="text-xs text-[var(--fg-faint)]">by {entry.user_username}</span>
          )}
        </div>
        {detailItems.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums]">
            {detailItems.map(([k, v]) => (
              <span key={k}>
                <span className="text-[var(--fg-faint)]">{k}:</span> {v}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ //

const ACTION_LABELS: Record<string, string> = {
  created: "Project created",
  cloned: "Cloned from existing project",
  metadata_updated: "Metadata updated",
  state_transition: "State transition",
  rubric_saved: "Rubric saved",
  questions_saved: "Questions saved",
  applications_loaded: "Applications loaded",
  human_scores_loaded: "Human scores loaded",
  splits_generated: "Splits generated",
  baseline_computed: "H-H baseline computed",
  calibration_examples_generated: "Calibration examples generated",
  disagreement_flagged: "Disagreement flagged",
  deleted: "Project deleted",
};

function humanize(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetails(details: Record<string, unknown> | null): [string, string][] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [k, formatValue(v)]);
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length <= 3 ? v.join(", ") : `[${v.length} items]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const ms = Date.now() - d.getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
