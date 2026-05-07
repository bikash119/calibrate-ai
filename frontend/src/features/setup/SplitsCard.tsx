import { Split as SplitIcon } from "lucide-react";

import { Card } from "../../components/ui/Card";
import { useApplications } from "../../hooks/useDataset";
import { useGenerateSplits, useSplits } from "../../hooks/useSplits";

const MIN_APPS = 10;

interface Props {
  projectId: number;
  disabled?: boolean;
}

export function SplitsCard({ projectId, disabled }: Props) {
  const splits = useSplits(projectId);
  const apps = useApplications(projectId);
  const generate = useGenerateSplits(projectId);

  const counts = splits.data?.counts ?? {};
  const dev = counts.dev ?? 0;
  const validation = counts.validation ?? 0;
  const test = counts.test ?? 0;
  const hasSplits = dev + validation + test > 0;
  const appCount = apps.data?.applications.length ?? 0;
  const canGenerate = appCount >= MIN_APPS && !splits.data?.test_consumed;

  const action = !disabled && (
    <button
      className="btn btn-sm"
      onClick={() => generate.mutate()}
      disabled={!canGenerate || generate.isPending}
      title={
        appCount < MIN_APPS
          ? `Need at least ${MIN_APPS} applications`
          : splits.data?.test_consumed
          ? "Test split has been consumed; clone the project to start over"
          : ""
      }
    >
      <SplitIcon className="w-3 h-3" /> {hasSplits ? "Regenerate" : "Generate"}
    </button>
  );

  return (
    <Card
      title="Data splits"
      desc="60/20/20 holdout (dev / validation / test). Reproducible from the project's random_seed. The test split is single-use."
      action={action}
    >
      {splits.isLoading ? (
        <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
      ) : !hasSplits ? (
        <div className="text-sm text-[var(--fg-muted)]">
          {appCount < MIN_APPS
            ? `Need at least ${MIN_APPS} applications (you have ${appCount}).`
            : "Splits not generated yet."}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <SplitStat label="Dev" value={dev} hint="Used during prompt iteration." />
          <SplitStat label="Validation" value={validation} hint="Held back during iteration; for early stopping." />
          <SplitStat
            label="Test"
            value={test}
            hint={splits.data?.test_consumed ? "Consumed." : "Single-use, before locking."}
            consumed={splits.data?.test_consumed}
          />
        </div>
      )}
      {generate.error && (
        <div className="mt-3 px-3 py-2 rounded-[var(--radius-sm)] text-xs bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
          {generate.error.message}
        </div>
      )}
    </Card>
  );
}

function SplitStat({
  label,
  value,
  hint,
  consumed,
}: {
  label: string;
  value: number;
  hint: string;
  consumed?: boolean;
}) {
  return (
    <div
      className={`px-3 py-2.5 rounded-[var(--radius-sm)] border ${
        consumed ? "border-[var(--yellow-border)] bg-[var(--yellow-bg)]" : "border-[var(--border)]"
      }`}
    >
      <div className="text-xs text-[var(--fg-muted)] mb-0.5">{label}</div>
      <div className="text-xl font-semibold [font-variant-numeric:tabular-nums]">{value}</div>
      <div className="text-xs text-[var(--fg-faint)] mt-0.5">{hint}</div>
    </div>
  );
}
