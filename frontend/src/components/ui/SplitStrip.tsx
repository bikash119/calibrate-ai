/**
 * SplitStrip — three side-by-side cards showing the agreement / off-by-1 /
 * off-by-2+ distribution for an iteration on a split.
 *
 * Inputs are the `exact` and `within_1` agreement metrics. The component is
 * pure-render: no fetching, no state. If either metric is missing, it shows a
 * muted "—".
 */

interface SplitStripProps {
  exact: number | null | undefined;
  within1: number | null | undefined;
  n: number | null | undefined;
}

interface Segment {
  label: string;
  hint: string;
  pct: number | null;
  count: number | null;
  color: string;
  bg: string;
  border: string;
}

export function SplitStrip({ exact, within1, n }: SplitStripProps) {
  const exactPct = exact != null ? exact : null;
  // off_by_1 = within_1 - exact (clamped to ≥0 to be safe against rounding noise).
  const offBy1Pct =
    exact != null && within1 != null ? Math.max(0, within1 - exact) : null;
  // off_by_2+ = 1 - within_1
  const offBy2Pct = within1 != null ? Math.max(0, 1 - within1) : null;

  const total = n ?? null;

  const segments: Segment[] = [
    {
      label: "Agreement",
      hint: "LLM matches human median exactly",
      pct: exactPct,
      count: total != null && exactPct != null ? Math.round(exactPct * total) : null,
      color: "var(--green)",
      bg: "var(--green-bg)",
      border: "var(--green-border)",
    },
    {
      label: "Off by 1",
      hint: "LLM differs from human median by 1 point",
      pct: offBy1Pct,
      count: total != null && offBy1Pct != null ? Math.round(offBy1Pct * total) : null,
      color: "var(--yellow)",
      bg: "var(--yellow-bg)",
      border: "var(--yellow-border)",
    },
    {
      label: "Off by 2+",
      hint: "LLM and human disagree by 2 or more — these are the triage cases",
      pct: offBy2Pct,
      count: total != null && offBy2Pct != null ? Math.round(offBy2Pct * total) : null,
      color: "var(--red)",
      bg: "var(--red-bg)",
      border: "var(--red-border)",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {segments.map((s) => (
        <SegmentCard key={s.label} {...s} />
      ))}
    </div>
  );
}

function SegmentCard({ label, hint, pct, count, color, bg, border }: Segment) {
  const pctStr = pct != null ? `${(pct * 100).toFixed(0)}%` : "—";
  const countStr = count != null ? count.toLocaleString() : "—";
  return (
    <div
      className="px-4 py-3 rounded-[var(--radius-sm)] border"
      style={{ borderColor: border, background: bg }}
      title={hint}
    >
      <div className="text-xs text-[var(--fg-muted)] mb-0.5">{label}</div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-2xl font-semibold [font-variant-numeric:tabular-nums]"
          style={{ color }}
        >
          {pctStr}
        </span>
        <span className="text-xs text-[var(--fg-muted)] [font-variant-numeric:tabular-nums]">
          {countStr}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--bg-elevated)" }}
        aria-hidden
      >
        <div
          className="h-full transition-[width] duration-300"
          style={{
            width: `${pct != null ? Math.max(2, pct * 100) : 0}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}
