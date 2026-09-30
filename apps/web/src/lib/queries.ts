import { queryOptions } from '@tanstack/react-query';
import type {
  BookingDetailResponse,
  RentPart,
  CompanyResponse,
  CouponListResponse,
  CompanyReviewListResponse,
  TruckRequestListResponse,
  TruckBanRule,
  TruckRoute,
  SiteForecastResponse,
  AreaForecastResponse,
  CustomerSiteResponse,
  BookingListResponse,
  BookingStatus,
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
  SiteDeploymentFilter,
  SiteListResponse,
  UserSelfResponse,
  UtilizationReportResponse,
  WeatherAdvisoryListResponse,
  PricingParametersInput,
  AvailabilityResponse,
  EdtrSheetContext,
  EdtrSettings,
  FieldSheetListResponse,
  EquipmentReportResponse,
  MaintenanceDetailResponse,
  NotificationListResponse,
  SiteDocument,
  SiteEquipmentWeatherResponse,
  TenantApplicationListResponse,
  TenantBranding,
} from '@arkilaunch/shared';
import { apiGet, apiPost } from './api-client.js';
import {
  getCustomers,
  getEquipment,
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
export const PAGE_SIZE = 20;

function withParams(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  return `${path}?${search}`;
}

// Keys are prefix-first, mirroring the API path, so invalidating ['reports'] hits every reports query.

export interface EquipmentListFilters {
  typeId?: string;
  status?: string;
  q?: string;
  missing?: 'photo' | 'price' | '';
}

export const equipmentQueries = {
  report: (equipmentId: string) =>
    queryOptions({
      queryKey: ['equipment', equipmentId, 'report'] as const,
      queryFn: () => apiGet<EquipmentReportResponse>(`/equipment/${equipmentId}/report`),
    }),
  maintenance: (equipmentId: string) =>
    queryOptions({
      queryKey: ['equipment', equipmentId, 'maintenance'] as const,
      queryFn: () => apiGet<MaintenanceDetailResponse>(`/equipment/${equipmentId}/maintenance`),
    }),
  availability: (equipmentId: string, from: string, to: string) =>
    queryOptions({
      queryKey: ['equipment', equipmentId, 'availability', from, to] as const,
      queryFn: () => apiGet<AvailabilityResponse>(`/equipment/${equipmentId}/availability?from=${from}&to=${to}`),
    }),
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

export const catalogQueries = {
  equipment: () =>
    queryOptions({
      queryKey: ['catalog', 'equipment'] as const,
      // ponytail: storefront filters in the browser at the API's 100-row ceiling; page on the server past 100 machines.
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
  list: (limit = PAGE_SIZE, offset = 0, deployment?: SiteDeploymentFilter) =>
    queryOptions({
      queryKey: ['sites', limit, offset, deployment ?? 'all'] as const,
      queryFn: () =>
        apiGet<SiteListResponse>(withParams('/sites', { limit, offset, deployment })),
    }),
  hub: (siteId: string) =>
    queryOptions({
      queryKey: ['sites', siteId, 'hub'] as const,
      queryFn: () => apiGet<SiteHubResponse>(`/sites/${siteId}/hub`),
    }),
  documents: (siteId: string) =>
    queryOptions({
      queryKey: ['sites', siteId, 'documents'] as const,
      queryFn: () => apiGet<{ documents: SiteDocument[]; proofComplete: boolean }>(`/sites/${siteId}/documents`),
    }),
  equipmentWeather: (siteId: string) =>
    queryOptions({
      queryKey: ['sites', siteId, 'equipment-weather'] as const,
      queryFn: () => apiGet<SiteEquipmentWeatherResponse>(`/sites/${siteId}/equipment-weather`),
    }),
};

export const tenantsQueries = {
  applications: (limit: number, offset: number) =>
    queryOptions({
      queryKey: ['tenants', 'applications', limit, offset] as const,
      queryFn: () => apiGet<TenantApplicationListResponse>(`/tenants/applications?limit=${limit}&offset=${offset}`),
    }),
  branding: (basePath: string) =>
    queryOptions({
      queryKey: ['branding', basePath] as const,
      queryFn: () => apiGet<TenantBranding>(`${basePath}/branding`),
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

export const truckBanRulesQuery = {
  queryKey: ['truck-ban-rules'] as const,
  queryFn: () => apiGet<TruckBanRule[]>('/truck-ban-rules'),
};

export const trucksQueries = {
  list: (limit: number, offset: number, q = '', status?: 'open' | 'closed') =>
    queryOptions({
      queryKey: ['truck-requests', limit, offset, q, status ?? 'all'] as const,
      queryFn: () =>
        apiGet<TruckRequestListResponse>(withParams('/truck-requests', { limit, offset, q, status })),
    }),
  route: (id: string) =>
    queryOptions({
      queryKey: ['truck-requests', id, 'route'] as const,
      queryFn: () => apiGet<TruckRoute>(`/truck-requests/${id}/route`),
      staleTime: Infinity,
      retry: false,
    }),
  mine: (limit: number, offset: number, q = '', status?: 'open' | 'closed') =>
    queryOptions({
      queryKey: [...MY_TRUCK_REQUESTS, limit, offset, q, status ?? 'all'] as const,
      queryFn: () =>
        apiGet<TruckRequestListResponse>(withParams('/me/truck-requests', { limit, offset, q, status })),
    }),
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
        apiGet<InvoiceListResponse>(withParams('/invoices', { limit, offset, status })),
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
        apiGet<IncidentListResponse>(withParams('/incidents', { limit, offset, kind })),
    }),
};

export interface BookingListFilters {
  status?: BookingStatus[];
  from?: string;
  to?: string;
  sort?: 'newest' | 'start';
}

export const bookingsQueries = {
  edtrSheet: (bookingId: string) =>
    queryOptions({
      queryKey: ['booking', bookingId, 'edtr-sheet'] as const,
      queryFn: () => apiGet<EdtrSheetContext>(`/bookings/${bookingId}/edtr-sheet`),
    }),
  list: (limit = PAGE_SIZE, offset = 0, q = '', filters: BookingListFilters = {}) =>
    queryOptions({
      queryKey: ['bookings', limit, offset, q, filters] as const,
      queryFn: () => {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (q) params.set('q', q);
        if (filters.status?.length) params.set('status', filters.status.join(','));
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.sort) params.set('sort', filters.sort);
        return apiGet<BookingListResponse>(`/bookings?${params.toString()}`);
      },
    }),
  detail: (bookingId: string) =>
    queryOptions({
      queryKey: ['booking', bookingId] as const,
      queryFn: () => apiGet<BookingDetailResponse>(`/bookings/${bookingId}`),
    }),
};

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
  equipment: () => queryOptions({ queryKey: ['reference', 'equipment'] as const, queryFn: getEquipment }),
  rentals: () => queryOptions({ queryKey: ['reference', 'rentals'] as const, queryFn: getRentals }),
  customers: () =>
    queryOptions({ queryKey: ['reference', 'customers'] as const, queryFn: getCustomers }),
  projectSites: () =>
    queryOptions({ queryKey: ['reference', 'project-sites'] as const, queryFn: getProjectSites }),
};

export interface PricingParametersRow {
  region: string;
  operatorHourlyPhp: string;
  maintenanceHourlyPhp: string;
  bufferPct: string;
  fuelLPerHour: string;
  fuelLPerKm: string;
  transportPhpPerKm: string;
  dieselOverridePhp: string | null;
  dieselOverrideDate: string | null;
}

export interface DieselReading {
  pricePhp: number;
  observedDate: string;
  source: string;
}

export const pricingQueries = {
  parameters: () =>
    queryOptions({
      queryKey: ['pricing-parameters'] as const,
      queryFn: () => apiGet<PricingParametersRow | null>('/pricing/parameters'),
    }),
  diesel: () =>
    queryOptions({
      queryKey: ['diesel-price'] as const,
      queryFn: () => apiGet<DieselReading | null>('/pricing/diesel-price'),
    }),
};

// Resend the override's own date: a re-stamped date would make a stale override fresh again.
export function saveParams(row: PricingParametersRow | null | undefined, patch: Partial<PricingParametersInput>) {
  return apiPost('/pricing/parameters', {
    region: row?.region ?? 'NCR',
    operatorHourlyPhp: Number(row?.operatorHourlyPhp),
    maintenanceHourlyPhp: Number(row?.maintenanceHourlyPhp),
    bufferPct: Number(row?.bufferPct),
    fuelLPerHour: Number(row?.fuelLPerHour),
    fuelLPerKm: Number(row?.fuelLPerKm),
    transportPhpPerKm: Number(row?.transportPhpPerKm),
    ...(row?.dieselOverridePhp
      ? { dieselOverridePhp: Number(row.dieselOverridePhp), dieselOverrideDate: row.dieselOverrideDate ?? undefined }
      : {}),
    ...patch,
  });
}

export const usersQueries = {
  me: () =>
    queryOptions({
      queryKey: ['users', 'me'] as const,
      queryFn: () => apiGet<UserSelfResponse>('/users/me'),
    }),
};

// Badges read `total`, never a page's length (capped at the API limit).
export const notificationsQueries = {
  list: (limit = 20, offset = 0) =>
    queryOptions({
      queryKey: ['notifications', limit, offset] as const,
      queryFn: () => apiGet<NotificationListResponse>(`/notifications?limit=${limit}&offset=${offset}`),
    }),
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
  settings: () =>
    queryOptions({ queryKey: ['edtr-settings'] as const, queryFn: () => apiGet<EdtrSettings>('/edtr-settings') }),
  fieldSheets: () =>
    queryOptions({ queryKey: ['field', 'edtr-sheets'] as const, queryFn: () => apiGet<FieldSheetListResponse>('/field/edtr-sheets') }),
  review: () =>
    queryOptions({
      queryKey: ['edtr', 'review'] as const,
      queryFn: () =>
        apiGet<{ items: { id: string; equipmentId: string; reportDate: string }[] }>('/edtr?status=review'),
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

export function fleetUtilizationPct(report: UtilizationReportResponse | undefined): number | null {
  if (!report || report.fleet.length === 0) return null;
  const sum = report.fleet.reduce((total, unit) => total + unit.utilizationPct, 0);
  return sum / report.fleet.length;
}

export type { CapabilitiesRef, CustomerRef, EquipmentTypeRef, ProjectSiteRef, RateCardRef, RentalRef };

export const companiesQueries = {
  mine: () =>
    queryOptions({
      queryKey: ['me', 'companies'] as const,
      queryFn: () => apiGet<CompanyResponse[]>('/me/companies'),
    }),
  // Signed URL lives 300s: staleTime must stay under it.
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
  // No retry: the forecast API is a metered free tier.
  site: (siteId: string) =>
    queryOptions({
      queryKey: ['me', 'sites', siteId, 'forecast'] as const,
      queryFn: () => apiGet<SiteForecastResponse>(`/me/sites/${siteId}/forecast`),
      staleTime: 1_800_000,
      retry: false,
    }),
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
  equipmentWeather: (siteId: string) =>
    queryOptions({
      queryKey: ['me', 'sites', siteId, 'equipment-weather'] as const,
      queryFn: () => apiGet<SiteEquipmentWeatherResponse>(`/me/sites/${siteId}/equipment-weather`),
    }),
};
