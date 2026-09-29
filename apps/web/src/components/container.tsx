import type { HTMLAttributes, ReactNode } from 'react';
import { Surface } from './surface.js';

export interface ContainerHeaderProps {
  title: string;
  count?: number | null | undefined;
  description?: ReactNode;
  actions?: ReactNode;
  filter?: ReactNode;
  pagination?: ReactNode;
}

export function ContainerHeader({ title, count, description, actions, filter, pagination }: ContainerHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-heading-lg text-text">
            {title}
            {count != null && <span className="ml-1.5 font-normal text-text-muted">({count.toLocaleString('en-PH')})</span>}
          </h2>
          {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {(filter || pagination) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">{filter}</div>
          {pagination}
        </div>
      )}
    </div>
  );
}

export interface ContainerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  header?: ContainerHeaderProps | undefined;
  footer?: ReactNode;
  flush?: boolean;
}

export function Container({ header, footer, flush = false, className = '', children, ...rest }: ContainerProps) {
  return (
    <Surface className={['relative overflow-hidden p-0', className].join(' ')} {...rest}>
      {header && <ContainerHeader {...header} />}
      <div className={flush ?'' : 'p-5'}>{children}</div>
      {footer}
    </Surface>
  );
}
