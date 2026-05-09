import { useState } from "react";
import { LayoutGrid, Upload } from "lucide-react";

import { Card } from "../../components/ui/Card";
import { useHumanScores, useUploadHumanScores } from "../../hooks/useDataset";
import { useRubric } from "../../hooks/useRubric";
import { BulkUploadModal } from "./BulkUploadModal";
import { CoverageMatrixModal } from "./CoverageMatrixModal";
import { WideUploadModal } from "./WideUploadModal";

interface Props {
  projectId: number;
  disabled?: boolean;
}

interface HumanScoreUpload {
  external_id: string;
  criterion_name: string;
  evaluator_id: string;
  score: number;
}

const REQUIRED_COLS = ["external_id", "criterion_name", "evaluator_id", "score"];

function parseCsvRow(row: Record<string, string>, headers: string[]): HumanScoreUpload {
  for (const c of REQUIRED_COLS) {
    if (!headers.includes(c)) {
      throw new Error(`missing required column '${c}'`);
    }
  }
  const score = Number(row.score);
  if (!Number.isFinite(score) || !Number.isInteger(score)) {
    throw new Error(`score must be an integer, got '${row.score}'`);
  }
  if (!row.external_id) throw new Error("external_id is empty");
  if (!row.criterion_name) throw new Error("criterion_name is empty");
  if (!row.evaluator_id) throw new Error("evaluator_id is empty");
  return {
    external_id: row.external_id,
    criterion_name: row.criterion_name,
    evaluator_id: row.evaluator_id,
    score,
  };
}

type UploadMode = "wide" | "long";

export function HumanScoresCard({ projectId, disabled }: Props) {
  const scores = useHumanScores(projectId);
  const rubric = useRubric(projectId);
  const upload = useUploadHumanScores(projectId);
  const [uploadMode, setUploadMode] = useState<UploadMode | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);

  const total = scores.data?.scores.length ?? 0;
  const evaluators = new Set(scores.data?.scores.map((s) => s.evaluator_id) ?? []);
  const criteriaNames = (rubric.data?.criteria ?? []).map((c) => c.name);

  const action = !disabled && (
    <div className="flex items-center gap-1.5">
      {total > 0 && (
        <button
          className="btn btn-sm"
          onClick={() => setShowCoverage(true)}
          title="Coverage matrix — apps scored per evaluator × criterion"
        >
          <LayoutGrid className="w-3 h-3" /> Coverage
        </button>
      )}
      <button
        className="btn btn-sm"
        onClick={() => setUploadMode("wide")}
        disabled={criteriaNames.length === 0}
        title={
          criteriaNames.length === 0
            ? "Save the rubric first — wide-format detection needs criterion names"
            : undefined
        }
      >
        <Upload className="w-3 h-3" /> Upload
      </button>
    </div>
  );

  return (
    <>
      <Card
        title="Human scores"
        desc="Per-evaluator ground-truth scores. The system computes medians automatically."
        action={action}
      >
        {scores.isLoading ? (
          <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
        ) : total === 0 ? (
          <div className="text-sm text-[var(--fg-muted)]">
            No scores yet. Upload at least 2 evaluators per (app, criterion) for the H-H baseline to be meaningful.
          </div>
        ) : (
          <div className="text-sm">
            <span className="font-semibold [font-variant-numeric:tabular-nums]">{total}</span>{" "}
            scores from{" "}
            <span className="font-semibold [font-variant-numeric:tabular-nums]">{evaluators.size}</span>{" "}
            evaluator{evaluators.size === 1 ? "" : "s"}.
          </div>
        )}
      </Card>

      {uploadMode === "wide" && (
        <WideUploadModal
          projectId={projectId}
          criteriaNames={criteriaNames}
          onClose={() => {
            setUploadMode(null);
            upload.reset();
          }}
          onSubmit={async (rows) => {
            await upload.mutateAsync(rows);
            setUploadMode(null);
          }}
          onSwitchToLong={() => {
            upload.reset();
            setUploadMode("long");
          }}
          submitting={upload.isPending}
          error={upload.error?.message ?? null}
        />
      )}

      {uploadMode === "long" && (
        <BulkUploadModal<HumanScoreUpload>
          title="Upload human scores (long format)"
          desc="One row per (evaluator, application, criterion). Score must be an integer within the criterion's scale."
          csvSchemaSpec={`Required columns (in any order):
  external_id      — application identifier
  criterion_name   — must match a criterion.name from the rubric
  evaluator_id     — any stable string per evaluator
  score            — integer in [scale_min, scale_max]`}
          csvExample={`external_id,criterion_name,evaluator_id,score
app-001,team,alice,4
app-001,team,bob,5
app-001,market,alice,3
app-001,market,bob,4`}
          jsonSchemaSpec={`Array<{
  external_id: string,
  criterion_name: string,
  evaluator_id: string,
  score: number
}>`}
          jsonExample={`[
  { "external_id": "app-001", "criterion_name": "team",   "evaluator_id": "alice", "score": 4 },
  { "external_id": "app-001", "criterion_name": "team",   "evaluator_id": "bob",   "score": 5 }
]`}
          parseCsvRow={parseCsvRow}
          onClose={() => {
            setUploadMode(null);
            upload.reset();
          }}
          onSubmit={async (parsed) => {
            await upload.mutateAsync(parsed);
            setUploadMode(null);
          }}
          submitting={upload.isPending}
          error={upload.error?.message ?? null}
        />
      )}

      {showCoverage && (
        <CoverageMatrixModal
          scores={scores.data?.scores ?? []}
          criteria={rubric.data?.criteria ?? []}
          onClose={() => setShowCoverage(false)}
        />
      )}
    </>
  );
}
