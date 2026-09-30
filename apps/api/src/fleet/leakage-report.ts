import { and, gte, inArray, lt, lte } from 'drizzle-orm';
import {
  bookingChangeRequests,
  customers,
  depositAccruals,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  invoiceLineItems,
  invoices,
  payments,
  projectSites,
  quotations,
  rentals,
  truckRequests,
  weatherAlerts,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  LeakageCause,
  LeakageMetric,
  LeakageReport,
  LeakageReportQuery,
  RequestContext,
  UtilizationReportResponse,
} from '@arkilaunch/shared';
import { round2HalfUp } from '@arkilaunch/shared';

const DAY_MS = 86_400_000;
const sum = (xs: number[]) => round2HalfUp(xs.reduce((a, b) => a + b, 0));
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {});
// A share of nothing is "no data", not 0%.
const pct = (part: number, whole: number) => (whole > 0 ? round2HalfUp((part / whole) * 100) : null);
const m = (label: string, value: number | null, unit: LeakageMetric['unit'], proxy?: boolean): LeakageMetric =>
  proxy ? { label, value, unit, proxy } : { label, value, unit };

// Maps the tenant's own records onto the study's fishbone of revenue-leakage causes.
// Filters: customer and equipment type narrow everything tied to a booking; tenant-wide
// facts (weather alerts, fleet master data) narrow only where the link exists.
export async function buildLeakageReport(
  ctx: RequestContext,
  q: { from: string; to: string } & Pick<LeakageReportQuery, 'customerId' | 'equipmentTypeId'>,
  utilization: UtilizationReportResponse,
): Promise<LeakageReport> {
  const start = new Date(`${q.from}T00:00:00+08:00`);
  const end = new Date(new Date(`${q.to}T00:00:00+08:00`).getTime() + DAY_MS);
  const inPeriod = (d: Date) => d >= start && d < end;

  return withTenantTx(ctx, async (tx) => {
    const [typeRows, fleetRows, customerRows, siteRows] = await Promise.all([
      tx.select().from(equipmentTypes),
      tx.select().from(equipment),
      tx.select().from(customers),
      tx.select({ id: projectSites.id }).from(projectSites),
    ]);
    const fleet = q.equipmentTypeId ? fleetRows.filter((e) => e.equipmentTypeId === q.equipmentTypeId) : fleetRows;
    const fleetIds = new Set(fleet.map((e) => e.id));

    const assignmentRows = await tx.select().from(equipmentAssignments);
    const assignments = assignmentRows.filter((a) => fleetIds.has(a.equipmentId));

    // The booking scope every transaction below is cut to.
    let rentalRows = await tx.select().from(rentals);
    if (q.customerId) rentalRows = rentalRows.filter((r) => r.customerId === q.customerId);
    if (q.equipmentTypeId) {
      const typed = new Set(assignments.map((a) => a.rentalId));
      rentalRows = rentalRows.filter((r) => typed.has(r.id));
    }
    const rentalIds = new Set(rentalRows.map((r) => r.id));
    const scoped = q.customerId || q.equipmentTypeId;
    const inScope = (rentalId: string | null) => (rentalId ? rentalIds.has(rentalId) : !scoped);

    const periodBookings = rentalRows.filter((r) => inPeriod(r.createdAt));
    const periodAssignments = assignments.filter(
      (a) => rentalIds.has(a.rentalId) && a.start < end && (a.end === null || a.end >= start),
    );

    const invoiceRows = (
      await tx.select().from(invoices).where(and(gte(invoices.createdAt, start), lt(invoices.createdAt, end)))
    ).filter((i) => i.status !== 'void' && inScope(i.rentalId));
    const invoiceIds = invoiceRows.map((i) => i.id);
    const [paymentRows, lineRows] = invoiceIds.length
      ? await Promise.all([
          tx.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)),
          tx.select({ id: invoiceLineItems.id }).from(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, invoiceIds)),
        ])
      : [[], []];
    const paid = paymentRows.filter((p) => p.status === 'paid');

    const edtrRows = (
      await tx.select().from(edtr).where(and(gte(edtr.reportDate, q.from), lte(edtr.reportDate, q.to)))
    ).filter((e) => rentalIds.has(e.rentalId) && fleetIds.has(e.equipmentId));
    const edtrIds = edtrRows.map((e) => e.id);
    const [edtrLines, reconRows] = edtrIds.length
      ? await Promise.all([
          tx.select().from(edtrLineItems).where(inArray(edtrLineItems.edtrId, edtrIds)),
          tx.select().from(edtrReconciliations).where(inArray(edtrReconciliations.edtrId, edtrIds)),
        ])
      : [[], []];

    const accrualRows = (
      await tx.select().from(depositAccruals).where(and(gte(depositAccruals.createdAt, start), lt(depositAccruals.createdAt, end)))
    ).filter((a) => rentalIds.has(a.rentalId));

    const quoteRows = (
      await tx.select().from(quotations).where(and(gte(quotations.createdAt, start), lt(quotations.createdAt, end)))
    ).filter((x) => (q.customerId ? x.customerId === q.customerId : true) && (!q.equipmentTypeId || inScope(x.rentalId)));
    // A revision chain is one quote; only its first revision counts.
    const rootQuotes = quoteRows.filter((x) => x.parentQuotationId === null);

    const changeRows = (
      await tx.select().from(bookingChangeRequests).where(and(gte(bookingChangeRequests.createdAt, start), lt(bookingChangeRequests.createdAt, end)))
    ).filter((c) => rentalIds.has(c.rentalId));

    // Trucks are not tied to a customer record, so a customer or equipment filter leaves them out.
    const tripRows = scoped
      ? []
      : await tx.select().from(truckRequests).where(and(gte(truckRequests.scheduledFor, start), lt(truckRequests.scheduledFor, end)));

    const alertRows = await tx.select().from(weatherAlerts).where(and(gte(weatherAlerts.effectiveAt, start), lt(weatherAlerts.effectiveAt, end)));
    const siteOf = new Map(rentalRows.map((r) => [r.id, r.projectSiteId]));
    const deployedInAlert = periodAssignments.filter((a) =>
      alertRows.some(
        (w) => w.projectSiteId === siteOf.get(a.rentalId) && a.start <= w.effectiveAt && (a.end === null || a.end >= w.effectiveAt),
      ),
    );

    const invoiced = sum(invoiceRows.map((i) => Number(i.amount)));
    const collected = sum(paid.map((p) => Number(p.amount)));
    const invoiceAt = new Map(invoiceRows.map((i) => [i.id, i.createdAt.getTime()]));
    const daysToPay = paid.map((p) => (p.createdAt.getTime() - (invoiceAt.get(p.invoiceId) ?? p.createdAt.getTime())) / DAY_MS);

    const util = utilization.fleet.filter((f) => fleetIds.has(f.equipmentId));
    const idle = util.filter((f) => f.utilizationPct === 0).length;
    const weatherHours = edtrLines.map((l) => (l.hoursWeather === null ? null : Number(l.hoursWeather))).filter((h) => h !== null);
    const recon = tally(reconRows.map((r) => r.status));
    const deltaCaught = sum(reconRows.filter((r) => r.status === 'discrepancy').map((r) => Math.abs(Number(r.deltaHours ?? 0))));
    const paidRentals = new Set(invoiceRows.filter((i) => paid.some((p) => p.invoiceId === i.id)).map((i) => i.rentalId));
    const converted = rootQuotes.filter((x) => x.rentalId !== null).length;
    const n = (xs: unknown[]) => (xs.length ? xs.length : null);

    const causes: LeakageCause[] = [
      {
        bone: 'Environment',
        cause: 'Severe climate disruptions',
        answer: 'PAGASA and forecast alerts per site; weather downtime is logged apart from billable hours.',
        metrics: [
          m('Weather alerts raised', alertRows.length, 'count'),
          m('Weather downtime hours logged', weatherHours.length ? sum(weatherHours) : null, 'hours'),
        ],
      },
      {
        bone: 'Environment',
        cause: 'Uncoordinated site-hold delays',
        answer: 'Extensions and cancellations go through tracked change requests instead of calls.',
        metrics: [
          m('Change requests filed', changeRows.length, 'count'),
          m('Approved', changeRows.filter((c) => c.status === 'approved').length, 'count'),
          m('Booking holds placed', periodBookings.filter((r) => r.holdExpiresAt !== null).length, 'count'),
        ],
      },
      {
        bone: 'Environment',
        cause: 'Geographic and transit risks',
        answer: 'Truck trips priced on routed km with tolls and truck-ban windows applied.',
        metrics: [
          m('Truck trips', scoped ? null : tripRows.length, 'count'),
          m('Confirmed km', scoped || !tripRows.length ? null : sum(tripRows.map((t) => Number(t.confirmedKm ?? t.estimatedKm))), 'km'),
        ],
      },
      {
        bone: 'Information/Data',
        cause: 'Lack of centralized operational reports',
        answer: 'This report: generated on demand from one tenant-scoped database.',
        metrics: [m('Records consolidated in this report', invoiceRows.length + paymentRows.length + periodBookings.length + quoteRows.length + edtrRows.length + tripRows.length, 'count')],
      },
      {
        bone: 'Information/Data',
        cause: 'Decentralized storage of transactions',
        answer: 'Bookings, quotes, time records, invoices and payments share one ledger per booking.',
        metrics: [
          m('Bookings', periodBookings.length, 'count'),
          m('Invoices', invoiceRows.length, 'count'),
          m('Payments', paymentRows.length, 'count'),
        ],
      },
      {
        bone: 'Information/Data',
        cause: 'Illegible or environmentally damaged EDTR',
        answer: 'Paper EDTRs are OCR-read; unreadable ones go to a human instead of into billing.',
        metrics: [
          m('EDTRs received', edtrRows.length, 'count'),
          m('Paper EDTRs read by OCR', edtrRows.filter((e) => e.source === 'paper_ocr').length, 'count'),
          m('Sent to human review', edtrRows.filter((e) => e.status === 'review').length, 'count'),
          m('Unreadable (hard failed)', edtrRows.filter((e) => e.status === 'hard_failed').length, 'count'),
        ],
      },
      {
        bone: 'Measurement',
        cause: 'Absence of standardized metrics',
        answer: 'One definition per KPI, computed the same way for every period.',
        metrics: [
          m('Average fleet utilization', util.length ? sum(util.map((f) => f.utilizationPct)) / util.length : null, 'pct'),
          m('Collection rate', pct(collected, invoiced), 'pct'),
        ],
      },
      {
        bone: 'Measurement',
        cause: 'Unreported key performance indicators',
        answer: 'KPIs are reported every period, not only when someone asks.',
        metrics: [
          m('Average days invoice to payment', daysToPay.length ? round2HalfUp(sum(daysToPay) / daysToPay.length) : null, 'days'),
          m('Quote-to-booking conversion', pct(converted, rootQuotes.length), 'pct'),
          m('Outstanding receivables', round2HalfUp(invoiced - collected), 'php'),
        ],
      },
      {
        bone: 'Technology/System',
        cause: 'Blind deployment of fleet during high-risk weather windows',
        answer: 'Deployments are cross-checked against active site alerts.',
        metrics: [
          m('Deployments in period', periodAssignments.length, 'count'),
          m('Deployments overlapping a site weather alert', n(periodAssignments) && deployedInAlert.length, 'count'),
        ],
      },
      {
        bone: 'Technology/System',
        cause: 'Reliance on informal coordination for asset lock-in',
        answer: 'A paid booking locks the unit; unpaid holds expire on their own.',
        metrics: [
          m('Bookings locked by payment', paidRentals.size, 'count'),
          m('Units assigned', new Set(periodAssignments.map((a) => a.equipmentId)).size, 'count'),
        ],
      },
      {
        bone: 'Method/Process',
        cause: 'Inefficient equipment rental process and quotation',
        answer: 'Quotes are priced from rate cards and diesel snapshots, with revisions tracked.',
        metrics: [
          m('Quotes issued', rootQuotes.length, 'count'),
          m('Revisions', quoteRows.length - rootQuotes.length, 'count'),
          m('Converted to bookings', converted, 'count'),
        ],
      },
      {
        bone: 'Method/Process',
        cause: 'Labor-intensive entry of reports to Excel',
        answer: 'Invoices and their lines are generated from approved hours; nothing is retyped.',
        metrics: [
          m('Invoices generated', invoiceRows.length, 'count'),
          m('Invoice lines generated', lineRows.length, 'count'),
        ],
      },
      {
        bone: 'Method/Process',
        cause: 'Unoptimized equipment scheduling',
        answer: 'Availability and utilization are visible per unit before booking.',
        metrics: [
          m('Units with zero utilization', util.length ? idle : null, 'count'),
          m('Units due for maintenance', util.filter((f) => f.maintenanceDue).length, 'count'),
        ],
      },
      {
        bone: 'People',
        cause: 'Human errors during repetitive manual billing',
        answer: 'No deposit deduction without a passing reconciliation or human approval.',
        metrics: [
          m('Reconciliations matched', recon.matched ?? 0, 'count'),
          m('Discrepancies caught', recon.discrepancy ?? 0, 'count'),
          m('Hours in dispute caught', n(reconRows) && deltaCaught, 'hours'),
          m('Deposit deductions, each gated by a reconciliation', accrualRows.length, 'count'),
        ],
      },
      {
        bone: 'People',
        cause: 'Uninformed personnel decision-making',
        answer: 'Staff see utilization, maintenance and receivables in one place.',
        metrics: [m('Maintenance flags surfaced', util.filter((f) => f.maintenanceDue).length, 'count')],
      },
      {
        bone: 'People',
        cause: 'Severe administrative cognitive fatigue',
        answer: 'Repetitive steps the system does instead of an admin.',
        metrics: [m('Manual steps avoided', invoiceRows.length + lineRows.length + edtrRows.length + quoteRows.length, 'count', true)],
      },
    ];

    return {
      period: { from: q.from, to: q.to },
      filters: {
        customer: q.customerId ? (customerRows.find((c) => c.id === q.customerId)?.companyName ?? null) : null,
        equipmentType: q.equipmentTypeId ? (typeRows.find((t) => t.id === q.equipmentTypeId)?.name ?? null) : null,
      },
      generatedAt: new Date().toISOString(),
      summary: {
        invoiced,
        collected,
        outstanding: round2HalfUp(invoiced - collected),
        collectionRatePct: pct(collected, invoiced),
        verifiedRevenue: sum(accrualRows.map((a) => Number(a.amount))),
      },
      master: {
        fleetTotal: fleet.length,
        fleetByStatus: tally(fleet.map((e) => e.availabilityStatus)),
        maintenanceDue: util.filter((f) => f.maintenanceDue).length,
        customersTotal: customerRows.length,
        customersKycApproved: customerRows.filter((c) => c.kycStatus === 'approved').length,
        projectSites: siteRows.length,
      },
      causes,
      ledger: {
        bookings: { count: periodBookings.length, byStatus: tally(periodBookings.map((r) => r.status)) },
        quotations: rootQuotes.length,
        truckTrips: tripRows.length,
        invoicesByType: invoiceRows.reduce<Record<string, number>>(
          (acc, i) => ({ ...acc, [i.invoiceType]: round2HalfUp((acc[i.invoiceType] ?? 0) + Number(i.amount)) }),
          {},
        ),
        payments: { count: paymentRows.length, paid: collected },
        depositDeductions: { count: accrualRows.length, amount: sum(accrualRows.map((a) => Number(a.amount))) },
      },
    };
  });
}
