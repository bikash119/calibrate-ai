import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Sparkles } from "lucide-react";

import { Card } from "../components/ui/Card";
import { PageHead } from "../components/ui/PageHead";
import { StatusPill } from "../components/ui/StatusPill";
import { useDashboardStats } from "../hooks/useDashboard";
import { usePrograms } from "../hooks/usePrograms";
import {
  useCreateDemoProject,
  useCreateProject,
  useProjects,
} from "../hooks/useProjects";
import type { ProjectItem } from "../schemas";

export function ProjectsDashboard() {
  const navigate = useNavigate();
  const projects = useProjects();
  const programs = usePrograms();
  const stats = useDashboardStats();
  const createProject = useCreateProject();
  const createDemoProject = useCreateDemoProject();

  const [showCreate, setShowCreate] = useState(false);

  const seedDemo = async () => {
    try {
      const created = await createDemoProject.mutateAsync();
      navigate(`/projects/${created.id}/setup`);
    } catch {
      /* surfaced via createDemoProject.error below */
    }
  };

  const projectsByProgram = useMemo(() => {
    const items = projects.data?.projects ?? [];
    const groups = new Map<string, ProjectItem[]>();
    for (const p of items) {
      const list = groups.get(p.program_name) ?? [];
      list.push(p);
      groups.set(p.program_name, list);
    }
    return Array.from(groups.entries());
  }, [projects.data]);

  const isLoading = projects.isLoading || programs.isLoading || stats.isLoading;
  const errorMsg = (projects.error || programs.error || stats.error)?.message;

  return (
    <div>
      <PageHead
        eyebrow="Workspace"
        title="Projects"
        lede="Each project is one calibration run — its own rubric, dataset, and human-scored ground truth."
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" /> New project
          </button>
        }
      />

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
        <StatCard label="Active projects" value={activeProjectsCount(stats.data)} />
        <StatCard label="In iteration" value={stats.data?.projects_by_state?.iterating ?? 0} />
        <StatCard label="Locked prompts" value={stats.data?.locked_prompts_count ?? "—"} />
        <StatCard label="Programs" value={stats.data?.programs_count ?? "—"} />
      </div>

      {errorMsg && (
        <Card className="mb-4">
          <div className="text-sm text-[var(--red-fg)]">{errorMsg}</div>
        </Card>
      )}

      {/* Projects list, grouped by program */}
      {isLoading && (
        <Card>
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        </Card>
      )}

      {!isLoading && projectsByProgram.length === 0 && (
        <Card title="No projects yet">
          <p className="text-sm text-[var(--fg-muted)] mb-3">
            A project pairs one rubric with one dataset of human-scored applications.
            Start with a real one, or load a demo to see the calibration loop end-to-end.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5" /> Create your first project
            </button>
            <button
              className="btn"
              onClick={seedDemo}
              disabled={createDemoProject.isPending}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {createDemoProject.isPending ? "Creating demo…" : "Try with demo data"}
            </button>
          </div>
          {createDemoProject.error && (
            <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
              {createDemoProject.error.message}
            </div>
          )}
        </Card>
      )}

      {!isLoading &&
        projectsByProgram.map(([programName, list]) => (
          <Card key={programName} title={programName} className="mb-4">
            <div className="grid gap-2">
              {list.map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}/setup`}
                  className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-[var(--fg-muted)] truncate">
                        {p.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 [font-variant-numeric:tabular-nums]">
                    <span className="text-xs text-[var(--fg-muted)]">
                      {p.application_count} apps · {p.iteration_count} iters
                    </span>
                    {p.latest_dev_qwk !== null && (
                      <span className="text-xs">QWK {p.latest_dev_qwk.toFixed(2)}</span>
                    )}
                    <StatusPill state={p.state} />
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        ))}

      {showCreate && (
        <CreateProjectModal
          programs={programs.data?.programs ?? []}
          programsLoading={programs.isLoading}
          onClose={() => setShowCreate(false)}
          onCreate={async (body) => {
            const project = await createProject.mutateAsync(body);
            setShowCreate(false);
            window.location.assign(`/projects/${project.id}/setup`);
          }}
          submitting={createProject.isPending}
          error={createProject.error?.message ?? null}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card noPad className="px-4 py-3">
      <div className="text-xs text-[var(--fg-muted)] mb-1">{label}</div>
      <div className="text-2xl font-semibold [font-variant-numeric:tabular-nums]">
        {value}
      </div>
    </Card>
  );
}

function activeProjectsCount(
  stats: { projects_by_state: Record<string, number> } | undefined,
): number | string {
  if (!stats) return "—";
  const s = stats.projects_by_state;
  return (
    (s?.setup ?? 0) +
    (s?.baseline_computed ?? 0) +
    (s?.iterating ?? 0) +
    (s?.test_run_complete ?? 0)
  );
}

// ------------------------------------------------------------------ //
// Create modal — minimal for pass 4b-1; will be extracted to features/ later
// ------------------------------------------------------------------ //

function CreateProjectModal({
  programs,
  programsLoading,
  onClose,
  onCreate,
  submitting,
  error,
}: {
  programs: { id: number; name: string }[];
  programsLoading: boolean;
  onClose: () => void;
  onCreate: (body: {
    program_id: number;
    name: string;
    description: string | null;
    language: string | null;
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("en");
  // User-picked id (or null if untouched). Effective id falls back to the first
  // program — recomputed on every render so the modal works even if programs
  // load AFTER it opened.
  const [pickedProgramId, setPickedProgramId] = useState<number | null>(null);
  const effectiveProgramId =
    pickedProgramId !== null
      ? pickedProgramId
      : programs[0]?.id ?? null;

  const noPrograms = !programsLoading && programs.length === 0;
  const canSubmit =
    name.trim().length > 0 && effectiveProgramId !== null && !noPrograms;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-lg">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold tracking-tight">New project</h3>
          <p className="text-xs text-[var(--fg-muted)] mt-0.5">
            One rubric + one dataset = one calibration project.
          </p>
        </div>
        <div className="px-5 py-4 grid gap-3">
          <Field label="Program">
            {programsLoading ? (
              <div className="text-sm text-[var(--fg-muted)] px-3 py-2">
                Loading programs…
              </div>
            ) : noPrograms ? (
              <div className="px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--yellow-bg)] border border-[var(--yellow-border)] text-[var(--yellow-fg)]">
                No programs found. Run <code>uv run python db_seed.py</code> to seed
                the default program, or create one on the Programs page.
              </div>
            ) : (
              <select
                value={effectiveProgramId ?? ""}
                onChange={(e) => setPickedProgramId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Grant 2026"
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </Field>
          <Field label="Language">
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="en"
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </Field>
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
            disabled={!canSubmit || submitting}
            onClick={() =>
              onCreate({
                program_id: effectiveProgramId as number,
                name: name.trim(),
                description: description.trim() || null,
                language: language.trim() || null,
              })
            }
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-[var(--fg-muted)]">{label}</span>
      {children}
    </label>
  );
}
