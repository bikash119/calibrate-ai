import { Info, AlertTriangle, CheckCircle } from "lucide-react";
import type { ReactNode } from "react";

type BannerKind = "info" | "warn" | "danger" | "success";

interface BannerProps {
  kind?: BannerKind;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}

const iconMap: Record<BannerKind, typeof Info> = {
  info: Info,
  warn: AlertTriangle,
  danger: AlertTriangle,
  success: CheckCircle,
};

export function Banner({ kind = "info", title, children, action }: BannerProps) {
  const IconComponent = iconMap[kind];
  return (
    <div className={`banner banner-${kind}`}>
      <div className="banner-icon">
        <IconComponent size={16} />
      </div>
      <div className="banner-body">
        {title && <div className="banner-title">{title}</div>}
        <div className="banner-text">{children}</div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
