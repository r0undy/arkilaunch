import { CircleCheck, CircleDashed, CircleDot, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import { formatStatus } from '../lib/format.js';

// Lifecycle status in a table cell: icon + label on a light tint, never
// colour alone (DESIGN.md §6). The weather and reconciliation scales keep
// their own solid StatusPill; this is for bookings, trucks, invoices,
// coupons, people and companies.

type Tone = 'success' | 'progress' | 'waiting' | 'danger' | 'muted';

const TONE: Record<Tone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: 'border-success/40 bg-success/10 text-success' },
  progress: { icon: CircleDot, className: 'border-accent/40 bg-accent/10 text-accent' },
  // Warning yellow is too light for text on white; the tint carries it.
  waiting: { icon: Clock, className: 'border-warning/60 bg-warning/15 text-text' },
  danger: { icon: TriangleAlert, className: 'border-error/40 bg-error/10 text-error' },
  muted: { icon: CircleDashed, className: 'border-border bg-surface-sunk text-text-muted' },
};

const STATUS_TONE: Record<string, Tone> = {
  // done
  paid: 'success',
  completed: 'success',
  approved: 'success',
  verified: 'success',
  active: 'success',
  available: 'success',
  reconciled: 'success',
  matched: 'success',
  agreed: 'success',
  // moving
  confirmed: 'progress',
  deployed: 'progress',
  km_confirmed: 'progress',
  issued: 'progress',
  invited: 'progress',
  // someone has to act
  pending: 'waiting',
  estimated: 'waiting',
  review: 'waiting',
  needs_review: 'waiting',
  submitted: 'waiting',
  unpaid: 'waiting',
  draft: 'waiting',
  maintenance: 'waiting',
  // went wrong
  overdue: 'danger',
  failed: 'danger',
  hard_failed: 'danger',
  rejected: 'danger',
  disputed: 'danger',
  discrepancy: 'danger',
  locked: 'danger',
  // over
  cancelled: 'muted',
  expired: 'muted',
  inactive: 'muted',
  disabled: 'muted',
  refunded: 'muted',
  revoked: 'muted',
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  const { icon: Icon, className } = TONE[(status && STATUS_TONE[status]) || 'muted'];
  return (
    <span
      className={[
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-semibold',
        className,
      ].join(' ')}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {label ?? formatStatus(status)}
    </span>
  );
}
