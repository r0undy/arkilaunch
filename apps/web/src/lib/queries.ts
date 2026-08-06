import { queryOptions } from '@tanstack/react-query';
import type {
  BookingListResponse,
  CatalogEquipment,
  CatalogEquipmentListResponse,
  FinancialReportResponse,
  IncidentListResponse,
  InvoiceListResponse,
  SiteListResponse,
  UtilizationReportResponse,
} from '@arkilaunch/shared';
import { apiGet } from './api-client.js';
import {
  getCustomers,
  getEquipmentTypes,
  getProjectSites,
  getRateCards,
  getRentals,
  type CustomerRef,
  type EquipmentRef,
  type EquipmentTypeRef,
  type ProjectSiteRef,
  type RateCardRef,
  type RentalRef,
} from './reference-client.js';

// Query-key convention: [resourceSegment, ...identifiers, filters?],
// lowercase, mirroring the API path -- ['equipment'], ['equipment', id],
// ['reports', 'utilization']. Prefix-first so
// invalidateQueries({ queryKey: ['reports'] }) hits every reports query.
// Keys never appear as literals at call sites; only these factories build
// them, so they cannot drift out of sync with each other.

export const equipmentQueries = {
  list: () =>
    queryOptions({
      queryKey: ['equipment'] as const,
      queryFn: () => apiGet<EquipmentRef[]>('/equipment'),
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
};

export const sitesQueries = {
  list: () =>
    queryOptions({
      queryKey: ['sites'] as const,
      queryFn: () => apiGet<SiteListResponse>('/sites'),
    }),
};

export const invoicesQueries = {
  list: () =>
    queryOptions({
      queryKey: ['invoices'] as const,
      queryFn: () => apiGet<InvoiceListResponse>('/invoices'),
    }),
};

export const incidentsQueries = {
  list: () =>
    queryOptions({
      queryKey: ['incidents'] as const,
      queryFn: () => apiGet<IncidentListResponse>('/incidents'),
    }),
};

export const bookingsQueries = {
  list: () =>
    queryOptions({
      queryKey: ['bookings'] as const,
      queryFn: () => apiGet<BookingListResponse>('/bookings'),
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
    queryOptions({ queryKey: ['reference', 'equipment-types'] as const, queryFn: getEquipmentTypes }),
  rateCards: () => queryOptions({ queryKey: ['reference', 'rate-cards'] as const, queryFn: getRateCards }),
  rentals: () => queryOptions({ queryKey: ['reference', 'rentals'] as const, queryFn: getRentals }),
  customers: () => queryOptions({ queryKey: ['reference', 'customers'] as const, queryFn: getCustomers }),
  projectSites: () =>
    queryOptions({ queryKey: ['reference', 'project-sites'] as const, queryFn: getProjectSites }),
};

export type {
  CustomerRef,
  EquipmentRef,
  EquipmentTypeRef,
  ProjectSiteRef,
  RateCardRef,
  RentalRef,
};
