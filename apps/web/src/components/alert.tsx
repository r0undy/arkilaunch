import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

// Cloudscape Alert: the one inline message inside a page, container or
// dialog (DSD §4, CR: console-components). Page-level save/error feedback is
// the Flashbar (toast.tsx), not this.

export type AlertType = 'info' | 'success' | 'warning' | 'error';

const TYPE: Record<AlertType, { icon: LucideIcon; box: string; iconClass: string }> = {
  info: { icon: Info, box: 'border-accent/40 bg-accent/5', iconClass: 'text-accent' },
  success: { icon: CircleCheck, box: 'border-success/40 bg-success/5', iconClass: 'text-success' },
  // Warning yellow fails as text; the icon and border carry it.
  warning: { icon: TriangleAlert, box: 'border-warning bg-warning/10', iconClass: 'text-text' },
  error: { icon: CircleX, box: 'border-error/40 bg-error/5', iconClass: 'text-error' },
};

export interface AlertProps {
  type?: AlertType;
  header?: ReactNode;
  children?: ReactNode;
  // A button on the right, e.g. Retry.
  action?: ReactNode;
  className?: string;
}

export function Alert({ type = 'info', header, children, action, className = '' }: AlertProps) {
  const { icon: Icon, box, iconClass } = TYPE[type];
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={['flex flex-wrap items-start gap-3 rounded-sm border px-4 py-3 text-sm text-text', box, className].join(' ')}
    >
      <Icon aria-hidden className={['mt-0.5 h-5 w-5 shrink-0', iconClass].join(' ')} />
      <div className="min-w-0 flex-1 basis-48">
        {header && <p className="font-semibold">{header}</p>}
        {children && <div className={header ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
