const STATE_LABELS: Record<string, { label: string; cls: string }> = {
  setup: { label: "Setup", cls: "" },
  baseline_computed: { label: "Baseline ready", cls: "pill-info" },
  iterating: { label: "Iterating", cls: "pill-yellow" },
  test_run_complete: { label: "Test run complete", cls: "pill-yellow" },
  locked: { label: "Locked", cls: "pill-green" },
  abandoned: { label: "Abandoned", cls: "pill-red" },
  archived: { label: "Archived", cls: "" },
};

interface StatusPillProps {
  state: string;
}

export function StatusPill({ state }: StatusPillProps) {
  const cfg = STATE_LABELS[state] ?? { label: state, cls: "" };
  return <span className={`pill ${cfg.cls}`}>{cfg.label}</span>;
}
