import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { Banner } from "../components/ui/Banner";
import { PageHead } from "../components/ui/PageHead";
import { CalibrationExamplesPanel } from "../features/iterate/CalibrationExamplesPanel";
import { DiffViewer } from "../features/iterate/DiffViewer";
import { DisagreementsPanel } from "../features/iterate/DisagreementsPanel";
import { IterationsList } from "../features/iterate/IterationsList";
import { IterationMetricsCard } from "../features/iterate/IterationMetricsCard";
import { PromptsPanel } from "../features/iterate/PromptsPanel";
import { ScoringPanel } from "../features/iterate/ScoringPanel";
import {
  useCreateIteration,
  useIteration,
  useIterations,
} from "../hooks/useIterations";
import { useProject } from "../hooks/useProjects";
import type { SplitName } from "../schemas";

type WorkbenchTab = "prompts" | "disagreements" | "examples" | "diff";
type ScoringSplit = Extract<SplitName, "dev" | "validation">;

export function IteratePage() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = projectIdStr ? Number(projectIdStr) : undefined;

  const project = useProject(projectId);
  const iterations = useIterations(projectId);
  const create = useCreateIteration(projectId ?? 0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useIteration(projectId, selectedId ?? undefined);

  const [tab, setTab] = useState<WorkbenchTab>("prompts");
  const [scoringSplit, setScoringSplit] = useState<ScoringSplit>("dev");
  const [diffFromVersion, setDiffFromVersion] = useState<number | null>(null);

  const latestId = useMemo(() => {
    const list = iterations.data?.iterations ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.version > b.version ? a : b)).id;
  }, [iterations.data]);

  useEffect(() => {
    if (selectedId == null && latestId != null) setSelectedId(latestId);
  }, [selectedId, latestId]);

  // Default the diff "from" picker to the previous version when switching to the diff tab
  useEffect(() => {
    if (tab !== "diff" || !detail.data || diffFromVersion != null) return;
    const list = iterations.data?.iterations ?? [];
    const earlier = list
      .filter((it) => it.version < detail.data!.version)
      .map((it) => it.version)
      .sort((a, b) => b - a);
    if (earlier.length > 0) setDiffFromVersion(earlier[0]);
  }, [tab, detail.data, iterations.data, diffFromVersion]);

  if (!projectId) return null;

  if (project.error || !project.data) {
    return (
      <>
        <PageHead eyebrow="Project" title="Iterate" />
        <Banner kind="danger" title="Project not found">
          {project.error?.message ?? "Project not accessible."}
        </Banner>
      </>
    );
  }

  const proj = project.data;
  const stateOk = proj.state === "iterating" || proj.state === "baseline_computed";

  const autoGenerate = async () => {
    try {
      const created = await create.mutateAsync({ prompts: [], note: null });
      setSelectedId(created.id);
    } catch {
      /* surfaced via create.error */
    }
  };

  const saveEdited = async (
    prompts: { criterion_id: number; system_prompt: string }[],
    note: string | null,
  ) => {
    const created = await create.mutateAsync({ prompts, note });
    setSelectedId(created.id);
  };

  return (
    <div>
      <PageHead
        eyebrow={proj.name}
        title="Iterate"
        lede="Generate, edit, and compare prompts. Score the dev split, watch LLM-H agreement against the H-H ceiling, triage disagreements, and refine."
      />

      {!stateOk && (
        <Banner kind="warn" title={`Project is in '${proj.state}'`}>
          Iteration is intended for the <code>baseline_computed</code> and{" "}
          <code>iterating</code> states. Some actions may be restricted.
        </Banner>
      )}

      <div className="grid gap-4 my-4 md:grid-cols-[300px_1fr]">
        <div>
          <IterationsList
            iterations={iterations.data?.iterations ?? []}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setDiffFromVersion(null);
            }}
            onAutoGenerate={autoGenerate}
            isGenerating={create.isPending}
            generateError={create.error?.message ?? null}
            disabled={!stateOk}
          />
        </div>

        <div className="grid gap-4">
          {detail.isLoading && (
            <div className="text-sm text-[var(--fg-muted)]">Loading iteration…</div>
          )}

          {detail.data && (
            <>
              <SplitSwitcher current={scoringSplit} onChange={setScoringSplit} />
              <ScoringPanel
                projectId={projectId}
                iterationId={detail.data.id}
                iterationVersion={detail.data.version}
                split={scoringSplit}
                disabled={!stateOk}
              />
              <IterationMetricsCard
                projectId={projectId}
                iterationId={detail.data.id}
                iterationVersion={detail.data.version}
                split={scoringSplit}
              />

              <TabStrip current={tab} onChange={setTab} />

              {tab === "prompts" && (
                <PromptsPanel
                  iteration={detail.data}
                  onSave={saveEdited}
                  saving={create.isPending}
                  error={create.error?.message ?? null}
                  disabled={!stateOk}
                />
              )}
              {tab === "disagreements" && (
                <DisagreementsPanel
                  projectId={projectId}
                  iterationId={detail.data.id}
                  split={scoringSplit}
                />
              )}
              {tab === "examples" && (
                <CalibrationExamplesPanel
                  projectId={projectId}
                  initialCriterionId={detail.data.prompts[0]?.criterion_id}
                />
              )}
              {tab === "diff" && (
                <DiffViewer
                  projectId={projectId}
                  toVersion={detail.data.version}
                  iterations={iterations.data?.iterations ?? []}
                  fromVersion={diffFromVersion}
                  onFromVersionChange={setDiffFromVersion}
                />
              )}
            </>
          )}

          {!detail.isLoading && !detail.data && iterations.data?.iterations.length === 0 && (
            <div className="text-sm text-[var(--fg-muted)] px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
              No iterations yet. Auto-generate v1 from the panel on the left to start.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //

function SplitSwitcher({
  current,
  onChange,
}: {
  current: ScoringSplit;
  onChange: (s: ScoringSplit) => void;
}) {
  const splits: { id: ScoringSplit; label: string; hint: string }[] = [
    { id: "dev", label: "Dev", hint: "Use during iteration" },
    { id: "validation", label: "Validation", hint: "Held-back signal — score sparingly" },
  ];
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-elevated)] border border-[var(--border)]">
      <span className="text-xs text-[var(--fg-muted)] mr-1">Split:</span>
      {splits.map((s) => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          title={s.hint}
          className={`px-2.5 py-1 text-xs rounded-[var(--radius-sm)] transition-colors ${
            current === s.id
              ? "bg-[var(--accent-bg)] text-[var(--accent)] border border-[var(--accent-border)]"
              : "border border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function TabStrip({
  current,
  onChange,
}: {
  current: WorkbenchTab;
  onChange: (t: WorkbenchTab) => void;
}) {
  const tabs: { id: WorkbenchTab; label: string }[] = [
    { id: "prompts", label: "Prompts" },
    { id: "disagreements", label: "Disagreements" },
    { id: "examples", label: "Calibration examples" },
    { id: "diff", label: "Diff" },
  ];
  return (
    <div className="flex gap-1 border-b border-[var(--border)]">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors ${
            current === t.id
              ? "border-[var(--accent)] text-[var(--fg)]"
              : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
