import type { FieldLogDayStatus } from './edtr.js';
import { round2HalfUp } from './pricing.js';

// Read models for the site hub and the booking's field-log rollup
// (cr-arkilaunch-edtr-site-hub-approval.md). Pure; the API assembles them.

// One EDTR row as the day-status rule sees it.
export interface DayLogRow {
  createdAt: string;
  // The row's reconciliation status, null while a paper row is still queued.
  reconStatus: string | null;
  correctionRequested: boolean;
  // The admin's office log is the second log, not a submission: it never
  // decides a day's status on its own.
  isOfficeLog: boolean;
}

// A day for one unit: approved wins outright; otherwise the LATEST
// submission decides (a corrected resubmission supersedes the rejected
// one); no submission at all is missing.
export function fieldLogDayStatus(rows: DayLogRow[]): FieldLogDayStatus {
  if (rows.some((r) => r.reconStatus === 'approved')) return 'approved';
  const submissions = rows.filter((r) => !r.isOfficeLog).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = submissions[0];
  if (!latest) return 'missing';
  if (latest.reconStatus === 'rejected') return latest.correctionRequested ? 'needs_correction' : 'rejected';
  return 'pending';
}

// The figures an approved day was billed on (classifyHours output, stored
// on the approved reconciliation so a rollup reads what was charged).
export interface ApprovedDayHours {
  running: number;
  billable: number;
  idle: number;
  breakdown: number;
  weather: number;
  otherDowntime: number;
}

export interface FieldLogTotals extends ApprovedDayHours {
  daysApproved: number;
  // Days from the span start to today (or the span end) for every unit.
  daysInSpan: number;
  pending: number;
  // Full days lost to downtime (non-billable >= 8 h), for the extend prompt.
  downtimeDays: number;
}

export interface FieldLogDay {
  date: string;
  equipmentId: string;
  status: FieldLogDayStatus;
  // Approved figures; null unless approved.
  hours: ApprovedDayHours | null;
  // The latest submission, for review. Omitted for a customer.
  edtrId: string | null;
  flags: string[];
  submittedBy: string | null;
  reason: string | null;
}

export interface FieldLogUnit {
  equipmentId: string;
  name: string;
  serialNo: string;
  rentalId: string;
  bookingCode: string;
  span: { from: string; to: string | null };
  operatorName: string | null;
  runtimeHours: number;
  lastMeterReading: number | null;
  // The unit's assignment says it is out there now (delivered), not just
  // that its dates have started. Optional: older responses lack it.
  onSite?: boolean;
  // Every assignment of the unit on this booking is returned.
  returned?: boolean;
}

export interface SiteHubResponse {
  site: {
    id: string;
    address: string;
    city: string | null;
    province: string | null;
    latitude: number;
    longitude: number;
    customerName: string | null;
  };
  rentals: {
    id: string;
    code: string;
    status: string;
    customerName: string | null;
    siteRep: string | null;
    start: string;
    end: string | null;
    extended: boolean;
  }[];
  units: FieldLogUnit[];
  days: FieldLogDay[];
  totals: FieldLogTotals & { billedPhp: number };
  personnel: {
    operators: { name: string; equipmentName: string }[];
    timekeepers: { userId: string; name: string }[];
    availableTimekeepers: { userId: string; name: string }[];
    siteReps: { name: string; bookingCode: string }[];
    truckCrew: { code: string; scheduledFor: string; driverName: string | null; helperName: string | null }[];
  };
  documents: { id: string; documentType: string; status: string; createdAt: string }[];
}

// Booking-level rollup (the drawer and the customer's booking page). A
// customer sees approved days only and a pending count of 0.
export interface BookingFieldLogs extends FieldLogTotals {
  days: { date: string; equipmentName: string; hours: ApprovedDayHours }[];
}

export const FULL_DAY_HOURS = 8;

export function sumApproved(days: ApprovedDayHours[]): ApprovedDayHours {
  const total = days.reduce(
    (acc, d) => ({
      running: acc.running + d.running,
      billable: acc.billable + d.billable,
      idle: acc.idle + d.idle,
      breakdown: acc.breakdown + d.breakdown,
      weather: acc.weather + d.weather,
      otherDowntime: acc.otherDowntime + d.otherDowntime,
    }),
    { running: 0, billable: 0, idle: 0, breakdown: 0, weather: 0, otherDowntime: 0 },
  );
  return {
    running: round2HalfUp(total.running),
    billable: round2HalfUp(total.billable),
    idle: round2HalfUp(total.idle),
    breakdown: round2HalfUp(total.breakdown),
    weather: round2HalfUp(total.weather),
    otherDowntime: round2HalfUp(total.otherDowntime),
  };
}

export function downtimeDays(days: ApprovedDayHours[]): number {
  return days.filter((d) => d.breakdown + d.weather + d.otherDowntime >= FULL_DAY_HOURS).length;
}

// edtr_line_items.notes on the admin's office log (the second log written
// when a day is approved in the site hub), so read models can tell it from
// a submission without another column.
export const OFFICE_LOG_NOTE = 'office_log';
