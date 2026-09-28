import { queryOptions } from '@tanstack/react-query';
import type {
  BookingDetailResponse,
  RentPart,
  CompanyResponse,
  CouponListResponse,
  CompanyReviewListResponse,
  TruckRequestListResponse,
  TruckRoute,
  SiteForecastResponse,
  AreaForecastResponse,
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
  EdtrDetailResponse,
  SiteHubResponse,
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

// The admin Equipment tab's filters (GET /equipment); empty = not applied.
export interface EquipmentListFilters {
  typeId?: string;
  status?: string;
  q?: string;
  missing?: 'photo' | 'price' | '';
}

export const equipmentQueries = {
  list: (limit = PAGE_SIZE, offset = 0, filters: EquipmentListFilters = {}) =>
    queryOptions({
      queryKey: ['equipment', limit, offset, filters] as const,
      queryFn: () => {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
        return apiGet<EquipmentListResponse>(`/equipment?${params}`);
      },
    }),
};

// @Public, anchor-tenant-only for now -- see catalog.service.ts. Unlike the
// other factories here this is reachable with no access token.
export const catalogQueries = {
  equipment: () =>
    queryOptions({
      queryKey: ['catalog', 'equipment'] as const,
      // ponytail: the storefront filters in the browser, so it takes the
      // API's 100-row ceiling (the default was 50). Past 100 machines, page
      // on the server -- that needs a total from the catalog SQL function.
      queryFn: () => apiGet<CatalogEquipmentListResponse>('/catalog/equipment?limit=100'),
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
  // The site hub (cr-arkilaunch-edtr-site-hub-approval.md).
  hub: (siteId: string) =>
    queryOptions({
      queryKey: ['sites', siteId, 'hub'] as const,
      queryFn: () => apiGet<SiteHubResponse>(`/sites/${siteId}/hub`),
    }),
};

export const couponsQueries = {
  list: (limit: number, offset: number) =>
    queryOptions({
      queryKey: ['coupons', limit, offset] as const,
      queryFn: () => apiGet<CouponListResponse>(`/coupons?limit=${limit}&offset=${offset}`),
    }),
};

export const MY_TRUCK_REQUESTS = ['me', 'truck-requests'] as const;

// Staff truck queue (cr-arkilaunch-console-polish.md). Every key starts
// with 'truck-requests', so invalidating that prefix refreshes them all.
export const trucksQueries = {
  list: (limit: number, offset: number, q = '', status?: 'open' | 'closed') =>
    queryOptions({
      queryKey: ['truck-requests', limit, offset, q, status ?? 'all'] as const,
      queryFn: () =>
        apiGet<TruckRequestListResponse>(
          `/truck-requests?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`,
        ),
    }),
  // The road line between a request's saved pins, for the drawer map.
  route: (id: string) =>
    queryOptions({
      queryKey: ['truck-requests', id, 'route'] as const,
      queryFn: () => apiGet<TruckRoute>(`/truck-requests/${id}/route`),
      staleTime: Infinity,
      retry: false,
    }),
  // The customer's own requests, one page at a time. Every key starts with
  // MY_TRUCK_REQUESTS, so invalidating that refreshes every page.
  mine: (limit: number, offset: number, q = '', status?: 'open' | 'closed') =>
    queryOptions({
      queryKey: [...MY_TRUCK_REQUESTS, limit, offset, q, status ?? 'all'] as const,
      queryFn: () =>
        apiGet<TruckRequestListResponse>(
          `/me/truck-requests?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`,
        ),
    }),
  // The same line for the customer's own request.
  myRoute: (id: string) =>
    queryOptions({
      queryKey: ['my-truck-route', id] as const,
      queryFn: () => apiGet<TruckRoute>(`/me/truck-requests/${id}/route`),
      staleTime: Infinity,
      retry: false,
    }),
};

export const invoicesQueries = {
  list: (limit = PAGE_SIZE, offset = 0, status?: 'issued' | 'paid') =>
    queryOptions({
      queryKey: ['invoices', limit, offset, status ?? 'all'] as const,
      queryFn: () =>
        apiGet<InvoiceListResponse>(`/invoices?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ''}`),
    }),
  detail: (invoiceId: string) =>
    queryOptions({
      queryKey: ['invoice', invoiceId] as const,
      queryFn: () => apiGet<InvoiceDetailResponse>(`/me/invoices/${invoiceId}`),
    }),
};

export const incidentsQueries = {
  list: (limit = PAGE_SIZE, offset = 0, kind?: 'weather' | 'discrepancy' | 'used_despite_warning') =>
    queryOptions({
      queryKey: ['incidents', limit, offset, kind ?? 'all'] as const,
      queryFn: () =>
        apiGet<IncidentListResponse>(`/incidents?limit=${limit}&offset=${offset}${kind ? `&kind=${kind}` : ''}`),
    }),
};

export const bookingsQueries = {
  // `q` narrows to booking codes starting with it (EQR-2026-00…).
  list: (limit = PAGE_SIZE, offset = 0, q = '') =>
    queryOptions({
      queryKey: ['bookings', limit, offset, q] as const,
      queryFn: () =>
        apiGet<BookingListResponse>(
          `/bookings?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        ),
    }),
  detail: (bookingId: string) =>
    queryOptions({
      queryKey: ['booking', bookingId] as const,
      queryFn: () => apiGet<BookingDetailResponse>(`/bookings/${bookingId}`),
    }),
};

// Wire shape of QuotesService.get/preview/create (apps/api/src/quotes/quotes.service.ts).
export interface QuoteLine {
  kind: 'equipment' | 'custom';
  description?: string;
  equipmentTypeId: string | null;
  equipmentTypeName?: string;
  rateCardId: string | null;
  quantity: number;
  estimatedHours: number;
  rentParts: RentPart[];
  rent: number;
  hourlyRate: number;
  operatingCost: number;
  buffer: number;
  subtotal: number;
}

export interface QuoteDetail {
  id: string;
  revision: number;
  status: string;
  dieselPrice: number;
  dieselPriceDate: string;
  priceStale: boolean;
  lineItems: QuoteLine[];
  mobilization: number;
  demobilization: number;
  subtotal: number;
  discount: number;
  total: number;
  createdAt?: string;
  customerName?: string;
  bookingCode?: string;
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

// Badge counts read `total`, not a page's length: a page tops out at the
// API's limit, so counting its rows capped every badge at 50.
export const notificationsQueries = {
  unreadCount: () =>
    queryOptions({
      queryKey: ['notifications', 'unread-count'] as const,
      queryFn: () => apiGet<{ total: number }>('/notifications?status=unread&limit=1'),
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
  reviewCount: () =>
    queryOptions({
      queryKey: ['edtr', 'review-count'] as const,
      queryFn: () => apiGet<{ total: number }>('/edtr?status=review&limit=1'),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: ['edtr', id] as const,
      queryFn: () => apiGet<EdtrDetailResponse>(`/edtr/${id}`),
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
  review: (kycStatus: 'pending' | 'approved' | 'rejected', limit: number, offset: number) =>
    queryOptions({
      queryKey: ['customers', 'review', kycStatus, limit, offset] as const,
      queryFn: () =>
        apiGet<CompanyReviewListResponse>(`/customers/review?kycStatus=${kycStatus}&limit=${limit}&offset=${offset}`),
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
  // No site of their own yet: the general Metro Manila forecast.
  area: () =>
    queryOptions({
      queryKey: ['me', 'forecast'] as const,
      queryFn: () => apiGet<AreaForecastResponse>('/me/forecast'),
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
