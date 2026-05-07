import { useCallback, useMemo, useState } from "react";
import { Upload } from "lucide-react";

import { Card } from "../../components/ui/Card";
import {
  useApplications,
  useQuestions,
  useUploadApplications,
} from "../../hooks/useDataset";
import { BulkUploadModal } from "./BulkUploadModal";

interface Props {
  projectId: number;
  disabled?: boolean;
}

interface ApplicationUpload {
  external_id: string;
  answers: Record<string, string>;
  metadata?: Record<string, string> | null;
}

export function ApplicationsCard({ projectId, disabled }: Props) {
  const apps = useApplications(projectId);
  const questions = useQuestions(projectId);
  const upload = useUploadApplications(projectId);
  const [showUpload, setShowUpload] = useState(false);

  const total = apps.data?.applications.length ?? 0;
  const scored = apps.data?.applications.filter((a) => a.has_human_scores).length ?? 0;

  const validKeys = useMemo(
    () => new Set((questions.data?.questions ?? []).map((q) => q.key)),
    [questions.data],
  );

  const parseCsvRow = useCallback(
    (row: Record<string, string>, headers: string[]): ApplicationUpload => {
      if (!headers.includes("external_id")) {
        throw new Error("CSV must include an 'external_id' column");
      }
      const externalId = row.external_id?.trim();
      if (!externalId) throw new Error("external_id is empty");

      const answers: Record<string, string> = {};
      const unknownColumns: string[] = [];
      for (const h of headers) {
        if (h === "external_id") continue;
        if (!validKeys.has(h)) {
          unknownColumns.push(h);
          continue;
        }
        // Empty cells → omit from answers (backend treats missing keys as absent)
        const cell = row[h];
        if (cell != null && cell !== "") answers[h] = cell;
      }
      if (unknownColumns.length > 0) {
        throw new Error(
          `unknown question keys: ${unknownColumns.join(", ")} — define them under Questions first`,
        );
      }
      return { external_id: externalId, answers };
    },
    [validKeys],
  );

  const action = !disabled && (
    <button className="btn btn-sm" onClick={() => setShowUpload(true)}>
      <Upload className="w-3 h-3" /> Upload
    </button>
  );

  return (
    <>
      <Card
        title="Applications"
        desc="The cohort of applications to score. Upload as CSV (one row per application, columns = question keys) or JSON."
        action={action}
      >
        {apps.isLoading ? (
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        ) : total === 0 ? (
          <div className="text-sm text-[var(--fg-muted)]">
            No applications yet. Click <em>Upload</em> to load a CSV or paste JSON.
          </div>
        ) : (
          <div className="text-sm">
            <span className="font-semibold [font-variant-numeric:tabular-nums]">{total}</span>{" "}
            applications loaded —{" "}
            <span className="[font-variant-numeric:tabular-nums]">{scored}</span> have human scores.
          </div>
        )}
      </Card>

      {showUpload && (
        <BulkUploadModal<ApplicationUpload>
          title="Upload applications"
          desc="One row per application. CSV columns must match defined question keys (plus an 'external_id' column)."
          csvSchemaSpec={`Required column: external_id
Other columns: one per question key defined under Questions
${
  validKeys.size === 0
    ? "(no question keys defined yet — go define them first)"
    : `Defined keys: ${[...validKeys].join(", ")}`
}`}
          csvExample={`external_id,team,market
app-001,"Three ex-Google engineers, 8+ years","B2B SaaS, ~10K SMBs in US"
app-002,"Solo founder","Consumers"`}
          jsonSchemaSpec={`Array<{
  external_id: string,
  answers: { [question.key]: string },
  metadata?: { [key: string]: string }
}>`}
          jsonExample={`[
  {
    "external_id": "app-001",
    "answers": { "team": "Three engineers, 8+ yrs", "market": "B2B SaaS" }
  }
]`}
          parseCsvRow={parseCsvRow}
          onClose={() => {
            setShowUpload(false);
            upload.reset();
          }}
          onSubmit={async (parsed) => {
            await upload.mutateAsync(parsed);
            setShowUpload(false);
          }}
          submitting={upload.isPending}
          error={upload.error?.message ?? null}
        />
      )}
    </>
  );
}
