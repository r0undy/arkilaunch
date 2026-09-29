import { CircleCheck, CircleDashed, CircleDot, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import { formatStatus } from '../lib/format.js';

// Lifecycle status in a table cell, drawn as a Cloudscape status indicator:
// a tone-colored icon + a plain label, no chip (DSD §4, CR:
// console-components). Never colour alone (DESIGN.md §6). The weather and
// reconciliation scales keep their own solid StatusPill; this is for
// bookings, trucks, invoices, coupons, people and companies.

type Tone = 'success' | 'progress' | 'waiting' | 'danger' | 'muted';

// The icon carries the colour, so warning yellow never has to pass as text.
const TONE: Record<Tone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: 'text-success' },
  progress: { icon: CircleDot, className: 'text-accent' },
  waiting: { icon: Clock, className: 'text-warning' },
  danger: { icon: TriangleAlert, className: 'text-error' },
  muted: { icon: CircleDashed, className: 'text-text-muted' },
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
  dispatched: 'progress',
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
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-text">
      <Icon aria-hidden className={['h-4 w-4 shrink-0', className].join(' ')} />
      {label ?? formatStatus(status)}
    </span>
  );
}
