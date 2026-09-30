import type { FieldLogDayStatus } from './edtr.js';
import { round2HalfUp } from './pricing.js';

export interface DayLogRow {
  createdAt: string;
  reconStatus: string | null;
  correctionRequested: boolean;
  // The admin's office log is the second log: it never decides a day's status on its own.
  isOfficeLog: boolean;
}

export function fieldLogDayStatus(rows: DayLogRow[]): FieldLogDayStatus {
  if (rows.some((r) => r.reconStatus === 'approved')) return 'approved';
  const submissions = rows.filter((r) => !r.isOfficeLog).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = submissions[0];
  if (!latest) return 'missing';
  if (latest.reconStatus === 'rejected') return latest.correctionRequested ? 'needs_correction' : 'rejected';
  return 'pending';
}

// Stored on the approved reconciliation so a rollup reads what was charged.
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
  daysInSpan: number;
  pending: number;
  downtimeDays: number;
}

export interface FieldLogDay {
  date: string;
  equipmentId: string;
  status: FieldLogDayStatus;
  hours: ApprovedDayHours | null;
  edtrId: string | null;
  flags: string[];
  submittedBy: string | null;
  reason: string | null;
}

export interface FieldLogUnit {
  equipmentId: string;
  photoUrl?: string | null;
  name: string;
  serialNo: string;
  rentalId: string;
  bookingCode: string;
  span: { from: string; to: string | null };
  operatorName: string | null;
  runtimeHours: number;
  lastMeterReading: number | null;
  onSite?: boolean;
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
  // Timekeeper sheet downloads today (Manila date), newest first.
  sheetDownloadsToday: { equipmentId: string; userName: string; at: string }[];
}

// A customer sees approved days only and a pending count of 0.
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

// Marks the admin's office log in edtr_line_items.notes (no dedicated column).
export const OFFICE_LOG_NOTE = 'office_log';
