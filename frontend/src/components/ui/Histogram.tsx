interface HistogramBucket {
  bucket: string;
  count: number;
}

interface HistogramProps {
  data: HistogramBucket[];
  height?: number;
  cutoffIndex?: number;
}

export function Histogram({ data, height = 120, cutoffIndex }: HistogramProps) {
  const max = Math.max(...data.map((d) => d.count));

  return (
    <div
      className="flex items-end gap-1.5"
      style={{ height, padding: "8px 0" }}
    >
      {data.map((d, i) => {
        const barHeight = (d.count / max) * (height - 32);
        const isBelowCutoff = cutoffIndex !== undefined && i <= cutoffIndex;

        return (
          <div
            key={i}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div
              className="numz"
              style={{ fontSize: 11, color: "var(--fg-faint)" }}
            >
              {d.count}
            </div>
            <div
              style={{
                width: "100%",
                height: barHeight,
                background: isBelowCutoff ? "var(--red)" : "var(--accent)",
                borderRadius: "3px 3px 0 0",
                opacity: 0.85,
              }}
            />
            <div
              className="numz"
              style={{ fontSize: 11, color: "var(--fg-muted)" }}
            >
              {d.bucket}
            </div>
          </div>
        );
      })}
    </div>
  );
}
