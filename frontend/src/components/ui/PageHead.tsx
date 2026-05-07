import type { ReactNode } from "react";

interface PageHeadProps {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}

export function PageHead({ eyebrow, title, lede, actions }: PageHeadProps) {
  return (
    <div className="page-head">
      <div className="flex items-start justify-between gap-4">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {lede && <div className="lede">{lede}</div>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}
