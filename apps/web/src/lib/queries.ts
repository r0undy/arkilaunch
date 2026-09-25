import { queryOptions } from '@tanstack/react-query';
import type {
  BookingDetailResponse,
  NegotiationMessageResponse,
  CompanyResponse,
  CompanyReviewResponse,
  SiteForecastResponse,
  CustomerSiteResponse,
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
  getCapabilities,
  getRentals,
  type CustomerRef,
  type EquipmentTypeRef,
  type ProjectSiteRef,
  type RateCardRef,
  type CapabilitiesRef,
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
      queryFn: () => apiGet<InvoiceDetailResponse>(`/me/invoices/${invoiceId}`),
    }),
};

export const incidentsQueries = {
  list: (limit = PAGE_SIZE, offset = 0, kind?: 'weather' | 'discrepancy') =>
    queryOptions({
      queryKey: ['incidents', limit, offset, kind ?? 'all'] as const,
      queryFn: () =>
        apiGet<IncidentListResponse>(`/incidents?limit=${limit}&offset=${offset}${kind ? `&kind=${kind}` : ''}`),
    }),
};

export const bookingsQueries = {
  list: (limit = PAGE_SIZE, offset = 0) =>
    queryOptions({
      queryKey: ['bookings', limit, offset] as const,
      queryFn: () => apiGet<BookingListResponse>(`/bookings?limit=${limit}&offset=${offset}`),
    }),
  detail: (bookingId: string) =>
    queryOptions({
      queryKey: ['booking', bookingId] as const,
      queryFn: () => apiGet<BookingDetailResponse>(`/bookings/${bookingId}`),
    }),
  // The negotiation thread. Polled, not pushed: there is no socket here,
  // and a counter-offer landing ten seconds late costs nothing.
  messages: (bookingId: string) =>
    queryOptions({
      queryKey: ['booking', bookingId, 'messages'] as const,
      queryFn: () => apiGet<NegotiationMessageResponse[]>(`/bookings/${bookingId}/messages`),
      refetchInterval: 10_000,
    }),
};

// Wire shape of QuotesService.get (apps/api/src/quotes/quotes.service.ts).
export interface QuoteDetail {
  id: string;
  revision: number;
  status: string;
  lineItems: {
    equipmentTypeId: string;
    equipmentTypeName?: string;
    quantity: number;
    estimatedHours: number;
    hourlyRate: number;
    subtotal: number;
  }[];
  subtotal: number;
  discount: number;
  total: number;
}

export const quotesQueries = {
  detail: (quoteId: string) =>
    queryOptions({
      queryKey: ['quote', quoteId] as const,
      queryFn: () => apiGet<QuoteDetail>(`/quotes/${quoteId}`),
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
  capabilities: () =>
    queryOptions({ queryKey: ['reference', 'capabilities'] as const, queryFn: getCapabilities }),
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

export type { CapabilitiesRef, CustomerRef, EquipmentTypeRef, ProjectSiteRef, RateCardRef, RentalRef };

// Customer prerequisites CR: the caller's own companies and sites.
export const companiesQueries = {
  mine: () =>
    queryOptions({
      queryKey: ['me', 'companies'] as const,
      queryFn: () => apiGet<CompanyResponse[]>('/me/companies'),
    }),
  // A 300s signed URL for one of the caller's own KYC documents, used as
  // the registration-certificate thumbnail on the company card. Short TTL,
  // so it is not cached beyond the screen that shows it.
  documentUrl: (companyId: string, documentId: string) =>
    queryOptions({
      queryKey: ['me', 'companies', companyId, 'documents', documentId, 'url'] as const,
      queryFn: () =>
        apiGet<{ url: string }>(`/me/companies/${companyId}/documents/${documentId}/url`),
      staleTime: 240_000,
      retry: false,
    }),
  review: (kycStatus: 'pending' | 'approved' | 'rejected') =>
    queryOptions({
      queryKey: ['customers', 'review', kycStatus] as const,
      queryFn: () => apiGet<CompanyReviewResponse[]>(`/customers/review?kycStatus=${kycStatus}`),
    }),
};

export const forecastQueries = {
  // The server caches on coordinates for the poller's own cadence, so this
  // staleTime only stops a remount refetching -- it is not the budget
  // control. Retry is off: an unavailable forecast is a state the rail
  // renders, not a transient to hammer through against a metered free tier.
  site: (siteId: string) =>
    queryOptions({
      queryKey: ['me', 'sites', siteId, 'forecast'] as const,
      queryFn: () => apiGet<SiteForecastResponse>(`/me/sites/${siteId}/forecast`),
      staleTime: 1_800_000,
      retry: false,
    }),
};

export const customerSitesQueries = {
  mine: () =>
    queryOptions({
      queryKey: ['me', 'sites'] as const,
      queryFn: () => apiGet<CustomerSiteResponse[]>('/me/sites'),
    }),
};
