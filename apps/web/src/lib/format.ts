// Screens were showing people raw database values: truncated UUIDs as the
// only identifier for a rental or an invoice, and lowercase enum members
// ('paper_ocr', 'timekeeper', 'deposit_deduction') as labels. This module
// turns both into something a yard supervisor can read, and is the single
// place those names are decided.

// ---------------------------------------------------------------- short codes

const CODE_PREFIXES = {
  rental: 'RNT',
  booking: 'BKG',
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

/**
 * A short, speakable reference for a record -- "RNT-F320" rather than
 * "f320ddee-f25e-4533-8d25-a1df25f1ca12".
 *
 * This is a display convenience, not an identifier: it is derived from the
 * UUID's first four hex characters and is not guaranteed unique. Always show
 * it beside a real human label (the machine, the dates, the customer), never
 * as the only thing distinguishing two rows, and keep the full id for
 * anything the API has to receive.
 */
export function shortCode(kind: CodeKind, id: string | null | undefined): string {
  if (!id) return '--';
  const stem = id.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `${CODE_PREFIXES[kind]}-${stem}`;
}

/**
 * Replace bare UUIDs inside server-generated prose with short codes.
 *
 * Invoice line descriptions are written by the reconciliation engine and
 * embed the ids it acted on, e.g. "EDTR reconciliation 90aa8b0a-2b49-...
 * (sources: 7a2a8af6-..., 680d7442-...)". That is three 36-character
 * identifiers on the line a customer reads to understand a charge, which
 * live QA of the invoice screen showed wrapping across two lines and
 * crowding out the part that means something.
 *
 * The ids are not dropped -- they become the same REC-/LOG- style reference
 * used everywhere else, so the row stays traceable and stays readable.
 */
export function condenseIds(text: string, kind: CodeKind = 'recon'): string {
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (id) => shortCode(kind, id),
  );
}

// ---------------------------------------------------------------- enum labels

const STATUS_LABELS: Record<string, string> = {
  // lifecycle
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
  // equipment
  available: 'Available',
  deployed: 'Deployed',
  maintenance: 'In maintenance',
  // billing
  issued: 'Issued',
  paid: 'Paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  failed: 'Failed',
  disputed: 'Disputed',
  refunded: 'Refunded',
  // field logs
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
  // kyc
  needs_review: 'Needs review',
  verified: 'Verified',
  unverified: 'Not verified',
  submitted: 'Submitted',
};

/** Title-cases an unknown enum member rather than showing raw snake_case. */
function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatStatus(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return STATUS_LABELS[value] ?? titleCase(value);
}

const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Platform administrator',
  owner: 'Owner',
  admin: 'Administrator',
  timekeeper: 'Field timekeeper',
  customer: 'Customer',
};

export function formatRole(value: string | null | undefined): string {
  if (!value) return 'Unknown role';
  return ROLE_LABELS[value] ?? titleCase(value);
}

const RATE_TYPE_LABELS: Record<string, string> = {
  hourly: 'Per hour',
  daily: 'Per day',
  weekly: 'Per week',
  monthly: 'Per month',
};

export function formatRateType(value: string | null | undefined): string {
  if (!value) return '--';
  return RATE_TYPE_LABELS[value] ?? titleCase(value);
}

const INVOICE_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  deposit_deduction: 'Deposit deduction',
  rental: 'Rental',
  penalty: 'Penalty',
  adjustment: 'Adjustment',
  booking: 'Rental and deposit',
};

export function formatInvoiceType(value: string | null | undefined): string {
  if (!value) return '--';
  return INVOICE_TYPE_LABELS[value] ?? titleCase(value);
}

const SOURCE_LABELS: Record<string, string> = {
  paper_ocr: 'Paper sheet',
  digital_entry: 'Typed in',
  manual_transcription: 'Typed from the sheet',
};

export function formatLogSource(value: string | null | undefined): string {
  if (!value) return '--';
  return SOURCE_LABELS[value] ?? titleCase(value);
}

const SEVERITY_LABELS: Record<string, string> = {
  none: 'Clear',
  watch: 'Watch',
  warning: 'Warning',
  stop_work: 'Stop work',
};

export function formatSeverity(value: string | null | undefined): string {
  if (!value) return 'No reading';
  return SEVERITY_LABELS[value] ?? titleCase(value);
}

// ------------------------------------------------------------------- numbers

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

/** "1 site" / "3 sites" -- the app previously wrote "site(s)". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-PH')} ${count === 1 ? singular : plural}`;
}

// --------------------------------------------------------------------- dates

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Date and time together, for a log entry where the hour matters.
 *
 * Takes a string as well as a Date on purpose: these values arrive as JSON,
 * so a field typed `Date` on the wire schema is a string at runtime, and
 * calling .toLocaleString() on it silently returned the raw ISO text.
 */
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

/** "8-12 Sep 2026", collapsing the repeated month and year. */
export function formatDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  if (!start && !end) return '--';
  if (!end) return formatDate(start);
  if (!start) return formatDate(end);
  const from = start instanceof Date ? start : new Date(start);
  const to = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '--';
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  if (sameMonth) {
    return `${from.getDate()}-${to.getDate()} ${to.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}`;
  }
  const fromPart = from.toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${fromPart} - ${formatDate(to)}`;
}

// -------------------------------------------------------------- place naming

/**
 * A site's display name, falling back through what the record actually has.
 * The last resort is a short code, never a bare UUID fragment.
 */
export function siteName(site: {
  id: string;
  city?: string | null;
  province?: string | null;
  name?: string | null;
}): string {
  return site.name ?? site.city ?? site.province ?? `Unnamed site ${shortCode('site', site.id)}`;
}

/**
 * Monday (YYYY-MM-DD, UTC) of the week a date falls in. The review queue
 * groups daily field logs by machine and week, matching the weekly EDTR
 * sheet (docs/proposal-edtr-weather-attestation.md §2.2).
 */
export function weekStart(value: string | Date): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
