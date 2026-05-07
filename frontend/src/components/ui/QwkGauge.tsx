interface QwkGaugeProps {
  hh: { qwkLow: number; qwkHigh: number };
  llmH: number;
}

export function QwkGauge({ hh, llmH }: QwkGaugeProps) {
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div>
      <div className="gauge">
        <div
          className="h-band"
          style={{
            left: pct(hh.qwkLow),
            width: `calc(${pct(hh.qwkHigh)} - ${pct(hh.qwkLow)})`,
          }}
        />
        <div
          className="marker llm"
          style={{ left: `calc(${pct(llmH)} - 1px)` }}
          title={`LLM-H ${llmH.toFixed(2)}`}
        />
      </div>
      <div className="gauge-scale">
        <span>0.0</span>
        <span>0.5</span>
        <span>1.0</span>
      </div>
    </div>
  );
}
