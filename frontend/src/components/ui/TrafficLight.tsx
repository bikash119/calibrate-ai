export type TrafficStatus = "green" | "yellow" | "red" | "gray";

interface TrafficLightProps {
  status: TrafficStatus;
  size?: number;
}

const dotClass: Record<TrafficStatus, string> = {
  green: "dot dot-green",
  yellow: "dot dot-yellow",
  red: "dot dot-red",
  gray: "dot dot-gray",
};

export function TrafficLight({ status, size = 8 }: TrafficLightProps) {
  return (
    <span
      className={dotClass[status]}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Determines traffic-light status from LLM-H score vs H-H confidence band.
 * Green: within H-H 95% CI
 * Yellow: outside CI but within 0.10 QWK of lower bound
 * Red: more than 0.10 below lower bound
 */
export function trafficStatusFor(
  llmH: number,
  hh: { qwkLow: number },
): TrafficStatus {
  if (llmH >= hh.qwkLow) return "green";
  if (llmH >= hh.qwkLow - 0.1) return "yellow";
  return "red";
}
