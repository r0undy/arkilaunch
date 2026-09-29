const CODE_PREFIXES = {
  invoice: 'INV',
  equipment: 'EQP',
  site: 'STE',
  log: 'LOG',
  recon: 'REC',
  quote: 'QTE',
  customer: 'CUS',
  document: 'DOC',
} as const;

export type CodeKind = keyof typeof CODE_PREFIXES;

// Display only, not unique: show beside a human label and send the full id to the API.
export function shortCode(kind: CodeKind, id: string | null | undefined): string {
  if (!id) return '--';
  const stem = id.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `${CODE_PREFIXES[kind]}-${stem}`;
}

export function condenseIds(text: string, kind: CodeKind = 'recon'): string {
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (id) => shortCode(kind, id),
  );
}

const labeler =
  (table: Record<string, string>, empty: string) =>
  (value: string | null | undefined): string =>
    value ? (table[value] ?? titleCase(value)) : empty;

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disabled: 'Deactivated',
  invited: 'Invited',
  locked: 'Locked',
  suspended: 'Suspended',
  revoked: 'Revoked',
  draft: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  available: 'Available',
  deployed: 'Deployed',
  maintenance: 'In maintenance',
  issued: 'Issued',
  paid: 'Paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  failed: 'Failed',
  disputed: 'Disputed',
  refunded: 'Refunded',
  queued: 'Waiting to be read',
  extracting: 'Being read',
  extracted: 'Read, awaiting match',
  review: 'Needs review',
  reconciled: 'Matched',
  hard_failed: 'Could not be read',
  matched: 'Matched',
  discrepancy: 'Logs disagree',
  unreadable: 'Unreadable',
  single_source: 'Waiting for the second log',
  needs_review: 'Needs review',
  verified: 'Verified',
  unverified: 'Not verified',
  submitted: 'Submitted',
};

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const formatStatus = labeler(STATUS_LABELS, 'Unknown');

const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Platform administrator',
  owner: 'Owner',
  admin: 'Administrator',
  timekeeper: 'Field timekeeper',
  customer: 'Customer',
};

export const formatRole = labeler(ROLE_LABELS, 'Unknown role');

const INVOICE_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  deposit_deduction: 'Deposit deduction',
  rental: 'Rental',
  penalty: 'Penalty',
  adjustment: 'Adjustment',
  booking: 'Rental and deposit',
};

export const formatInvoiceType = labeler(INVOICE_TYPE_LABELS, '--');

const SOURCE_LABELS: Record<string, string> = {
  paper_ocr: 'Paper sheet',
  digital_entry: 'Typed in',
  manual_transcription: 'Typed from the sheet',
};

export const formatLogSource = labeler(SOURCE_LABELS, '--');

const SEVERITY_LABELS: Record<string, string> = {
  none: 'Clear',
  watch: 'Watch',
  warning: 'Warning',
  stop_work: 'Stop work',
};

export const formatSeverity = labeler(SEVERITY_LABELS, 'No reading');

export function formatPeso(amount: number | string | null | undefined): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
}

export function formatHours(value: number | string | null | undefined): string {
  const hours = typeof value === 'string' ? Number(value) : value;
  if (hours == null || Number.isNaN(hours)) return '--';
  return `${hours.toLocaleString('en-PH', { maximumFractionDigits: 2 })} h`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-PH')} ${count === 1 ? singular : plural}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Accepts strings: a wire `Date` is a string at runtime.
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function siteName(site: {
  id: string;
  city?: string | null;
  province?: string | null;
  name?: string | null;
}): string {
  return site.name ?? site.city ?? site.province ?? `Unnamed site ${shortCode('site', site.id)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStart(value: string | Date): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
