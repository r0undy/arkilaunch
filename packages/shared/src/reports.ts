import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_REPORT_DAYS = 366;

export const LeakageReportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    customerId: z.string().uuid().optional(),
    equipmentTypeId: z.string().uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must be on or before to', path: ['from'] })
  .refine(
    (q) => !q.from || !q.to || (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_REPORT_DAYS,
    { message: `range is at most ${MAX_REPORT_DAYS} days`, path: ['to'] },
  );
export type LeakageReportQuery = z.infer<typeof LeakageReportQuerySchema>;

// value null = no data in period; the report prints that instead of a zero it cannot vouch for.
export interface LeakageMetric {
  label: string;
  value: number | null;
  unit: 'php' | 'hours' | 'count' | 'pct' | 'days' | 'km';
  proxy?: boolean;
}

// The six bones of the study's fishbone: revenue leakage in small heavy-equipment rental companies.
export const LEAKAGE_BONES = ['Environment', 'Information/Data', 'Measurement', 'Technology/System', 'Method/Process', 'People'] as const;
export type LeakageBone = (typeof LEAKAGE_BONES)[number];

export interface LeakageCause {
  bone: LeakageBone;
  cause: string;
  answer: string;
  metrics: LeakageMetric[];
}

export interface LeakageReport {
  period: { from: string; to: string };
  filters: { customer: string | null; equipmentType: string | null };
  generatedAt: string;
  summary: {
    invoiced: number;
    collected: number;
    outstanding: number;
    collectionRatePct: number | null;
    verifiedRevenue: number;
  };
  master: {
    fleetTotal: number;
    fleetByStatus: Record<string, number>;
    maintenanceDue: number;
    customersTotal: number;
    customersKycApproved: number;
    projectSites: number;
  };
  causes: LeakageCause[];
  ledger: {
    bookings: { count: number; byStatus: Record<string, number> };
    quotations: number;
    truckTrips: number;
    invoicesByType: Record<string, number>;
    payments: { count: number; paid: number };
    depositDeductions: { count: number; amount: number };
  };
}
