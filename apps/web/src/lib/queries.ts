import { queryOptions } from '@tanstack/react-query';
import type {
  BookingListResponse,
  CatalogEquipment,
  CatalogEquipmentListResponse,
  CatalogTestimonialListResponse,
  EquipmentListResponse,
  FinancialReportResponse,
  IncidentListResponse,
  InvoiceDetailResponse,
  InvoiceListResponse,
  SiteListResponse,
  UserSelfResponse,
  UtilizationReportResponse,
  WeatherAdvisoryListResponse,
} from '@arkilaunch/shared';
import { apiGet } from './api-client.js';
import {
  getCustomers,
  getEquipmentTypes,
  getProjectSites,
  getRateCards,
  getRentals,
  type CustomerRef,
  type EquipmentTypeRef,
  type ProjectSiteRef,
  type RateCardRef,
  type RentalRef,
} from './reference-client.js';
import { PAGE_SIZE } from '../components/pagination.js';

// Query-key convention: [resourceSegment, ...identifiers, filters?],
// lowercase, mirroring the API path -- ['equipment'], ['equipment', id],
// ['reports', 'utilization']. Prefix-first so
// invalidateQueries({ queryKey: ['reports'] }) hits every reports query.
// Keys never appear as literals at call sites; only these factories build
// them, so they cannot drift out of sync with each other.

export const equipmentQueries = {
  list: (limit = PAGE_SIZE, offset = 0) =>
    queryOptions({
      queryKey: ['equipment', limit, offset] as const,
      queryFn: () => apiGet<EquipmentListResponse>(`/equipment?limit=${limit}&offset=${offset}`),
    }),
};

// @Public, anchor-tenant-only for now -- see catalog.service.ts. Unlike the
// other factories here this is reachable with no access token.
export const catalogQueries = {
  equipment: () =>
    queryOptions({
      queryKey: ['catalog', 'equipment'] as const,
      queryFn: () => apiGet<CatalogEquipmentListResponse>('/catalog/equipment'),
    }),
  equipmentDetail: (id: string) =>
    queryOptions({
      queryKey: ['catalog', 'equipment', id] as const,
      queryFn: () => apiGet<CatalogEquipment>(`/catalog/equipment/${id}`),
    }),
  testimonials: () =>
    queryOptions({
      queryKey: ['catalog', 'testimonials'] as const,
      queryFn: () => apiGet<CatalogTestimonialListResponse>('/catalog/testimonials'),
    }),
};

export const sitesQueries = {
  list: (limit = PAGE_SIZE, offset = 0) =>
    queryOptions({
      queryKey: ['sites', limit, offset] as const,
      queryFn: () => apiGet<SiteListResponse>(`/sites?limit=${limit}&offset=${offset}`),
    }),
};

export const invoicesQueries = {
  list: (limit = PAGE_SIZE, offset = 0) =>
    queryOptions({
      queryKey: ['invoices', limit, offset] as const,
      queryFn: () => apiGet<InvoiceListResponse>(`/invoices?limit=${limit}&offset=${offset}`),
    }),
  detail: (invoiceId: string) =>
    queryOptions({
      queryKey: ['invoice', invoiceId] as const,
      queryFn: () => apiGet<InvoiceDetailResponse>(`/invoices/${invoiceId}`),
    }),
};

export const incidentsQueries = {
  list: (limit = PAGE_SIZE, offset = 0) =>
    queryOptions({
      queryKey: ['incidents', limit, offset] as const,
      queryFn: () => apiGet<IncidentListResponse>(`/incidents?limit=${limit}&offset=${offset}`),
    }),
};

export const bookingsQueries = {
  list: (limit = PAGE_SIZE, offset = 0) =>
    queryOptions({
      queryKey: ['bookings', limit, offset] as const,
      queryFn: () => apiGet<BookingListResponse>(`/bookings?limit=${limit}&offset=${offset}`),
    }),
};

export interface ReportsSnapshot {
  utilization: UtilizationReportResponse;
  financial: FinancialReportResponse;
}

export const reportQueries = {
  // One query for both reports, shared by app.index.tsx (dashboard gauge)
  // and app.insights.tsx (full detail) so navigating between them reuses
  // the cache. Previously each screen awaited these sequentially inside its
  // own hand-rolled fetcher; Promise.all runs them in parallel.
  snapshot: () =>
    queryOptions({
      queryKey: ['reports', 'snapshot'] as const,
      queryFn: async (): Promise<ReportsSnapshot> => {
        const [utilization, financial] = await Promise.all([
          apiGet<UtilizationReportResponse>('/reports/utilization'),
          apiGet<FinancialReportResponse>('/reports/financial'),
        ]);
        return { utilization, financial };
      },
    }),
};

export const referenceQueries = {
  equipmentTypes: () =>
    queryOptions({
      queryKey: ['reference', 'equipment-types'] as const,
      queryFn: getEquipmentTypes,
    }),
  rateCards: () =>
    queryOptions({ queryKey: ['reference', 'rate-cards'] as const, queryFn: getRateCards }),
  rentals: () => queryOptions({ queryKey: ['reference', 'rentals'] as const, queryFn: getRentals }),
  customers: () =>
    queryOptions({ queryKey: ['reference', 'customers'] as const, queryFn: getCustomers }),
  projectSites: () =>
    queryOptions({ queryKey: ['reference', 'project-sites'] as const, queryFn: getProjectSites }),
};

export const usersQueries = {
  me: () =>
    queryOptions({
      queryKey: ['users', 'me'] as const,
      queryFn: () => apiGet<UserSelfResponse>('/users/me'),
    }),
};

export const notificationsQueries = {
  list: () =>
    queryOptions({
      queryKey: ['notifications'] as const,
      queryFn: () => apiGet<{ items: { id: string; status: string }[] }>('/notifications'),
    }),
};

export const weatherQueries = {
  advisories: () =>
    queryOptions({
      queryKey: ['weather', 'advisories'] as const,
      queryFn: () => apiGet<WeatherAdvisoryListResponse>('/weather/advisories'),
    }),
};

export const edtrQueries = {
  list: () =>
    queryOptions({
      queryKey: ['edtr'] as const,
      queryFn: () => apiGet<{ items: unknown[] }>('/edtr'),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: ['edtr', id] as const,
      queryFn: () => apiGet<unknown>(`/edtr/${id}`),
    }),
};

// Fleet-wide utilization %, derived client-side from the per-unit
// UtilizationReportResponse.fleet[].utilizationPct (there is no top-level
// aggregate field on the wire -- see PLAN Phase 1 note).
export function fleetUtilizationPct(report: UtilizationReportResponse | undefined): number | null {
  if (!report || report.fleet.length === 0) return null;
  const sum = report.fleet.reduce((total, unit) => total + unit.utilizationPct, 0);
  return sum / report.fleet.length;
}

export type { CustomerRef, EquipmentTypeRef, ProjectSiteRef, RateCardRef, RentalRef };
