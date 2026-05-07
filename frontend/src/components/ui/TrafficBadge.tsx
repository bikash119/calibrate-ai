import { TrafficLight, type TrafficStatus } from "./TrafficLight";

interface TrafficBadgeProps {
  status: TrafficStatus;
  label: string;
}

export function TrafficBadge({ status, label }: TrafficBadgeProps) {
  return (
    <span className={`pill pill-${status}`}>
      <TrafficLight status={status} />
      {label}
    </span>
  );
}
