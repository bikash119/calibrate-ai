import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  desc?: string;
  action?: ReactNode;
  noPad?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ title, desc, action, noPad, className = "", children }: CardProps) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {desc && <div className="desc">{desc}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={noPad ? "" : "card-pad"}>{children}</div>
    </div>
  );
}
