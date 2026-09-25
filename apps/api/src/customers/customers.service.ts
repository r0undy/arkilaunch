import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  addresses,
  auditLogs,
  customerContacts,
  customers,
  kycDocuments,
  notifications,
  projectSites,
  users,
  withTenantTx,
  type db,
} from '@arkilaunch/db';
import {
  DTI_REGEX,
  ExtractionUnavailableError,
  hasRequiredCompanyDocuments,
  normalizePcn,
  normalizeTin,
  PHILSYS_PCN_REGEX,
  REGISTRY_DOCUMENT_TYPES,
  SEC_REGEX,
  TIN_REGEX,
  type CompanyDocumentReadResponse,
  type CompanyDocumentUpload,
  type CompanyReviewComment,
  type CompanyReviewResponse,
  type DocumentIntelligencePort,
  type KycScanResponse,
} from '@arkilaunch/shared';
import { KYC_MODEL_ID, NATIONAL_ID_MODEL_ID } from '@arkilaunch/document-intelligence';
import { createWeatherAdapter } from '@arkilaunch/weather';
import { WEATHER_FORECAST_PORT } from './weather.tokens.js';
import {
  WEATHER_POLL_CADENCE_MINUTES,
  WeatherUnavailableError,
  type DailyForecast,
  type SiteForecastResponse,
  type WeatherForecastPort,
} from '@arkilaunch/shared';
import { DOCUMENT_INTELLIGENCE_PORT } from '../kyc/kyc.tokens.js';
import type {
  CompanyCreate,
  CompanyUpdate,
  CompanyDecision,
  CompanyResponse,
  CustomerSiteCreate,
  CustomerSiteResponse,
  RequestContext,
} from '@arkilaunch/shared';
import { ownCustomers, ownsCustomer } from '../common/customer-scope.js';
import { EventsService } from '../events/events.service.js';
import { notifyStaff } from '../common/notify-customer.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Customer prerequisites CR: the companies a customer login owns (Figma
// 582:3946 "Add New Company"), their verification documents, and the
// project sites they deliver to. RLS bounds the tenant; ownCustomers()
// bounds a customer to their own companies.

// Forecasts are cached in-process, keyed on coordinates rounded to ~100 m so
// neighbouring sites share one upstream call.
//
// This is the load-bearing half: a client-side staleTime does nothing about N
// customers each opening the browse page. The free tier's daily call budget
// (docs/cr-arkilaunch-open-meteo-free-tier.md) was sized for the poller
// alone, and this route is the first thing customers can trigger directly.
// Successes only -- a cached failure would turn one bad minute into thirty.
//
// ponytail: per-instance Map. A shared cache only matters above ~2 replicas.
const FORECAST_TTL_MS = WEATHER_POLL_CADENCE_MINUTES * 60_000;
const forecastCache = new Map<string, { days: DailyForecast[]; fetchedAt: string; at: number }>();

function forecastKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function readForecastCache(latitude: number, longitude: number) {
  const hit = forecastCache.get(forecastKey(latitude, longitude));
  if (!hit) return null;
  if (Date.now() - hit.at > FORECAST_TTL_MS) {
    forecastCache.delete(forecastKey(latitude, longitude));
    return null;
  }
  return hit;
}

function writeForecastCache(
  latitude: number,
  longitude: number,
  days: DailyForecast[],
  fetchedAt: string,
): void {
  forecastCache.set(forecastKey(latitude, longitude), { days, fetchedAt, at: Date.now() });
}

/** Test seam: the cache is module state and would otherwise leak across specs. */
export function __clearForecastCache(): void {
  forecastCache.clear();
}

// Response field -> the snake_case port key azure-adapter.ts maps it to.
// One table for every read, so adding a field is one line, not six.
const READ_FIELDS = {
  companyName: 'company_name',
  tin: 'tin',
  secNumber: 'sec_number',
  dtiNumber: 'dti_number',
  registeredAddress: 'registered_address',
  registrationDate: 'registration_date',
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  idNumber: 'id_number',
  birthDate: 'birth_date',
  sex: 'sex',
  address: 'address',
} as const;
type ReadField = keyof typeof READ_FIELDS;

// Which fields each paper actually prints. The customer's scan suggests only
// these, so a SEC certificate never prefills a TIN it does not carry.
const SCAN_FIELDS: Record<string, ReadField[]> = {
  government_id: ['firstName', 'middleName', 'lastName', 'idNumber', 'birthDate', 'sex', 'address'],
  sec_certificate: ['companyName', 'secNumber', 'registeredAddress', 'registrationDate'],
  bir_cor: ['companyName', 'tin', 'registeredAddress'],
  dti_certificate: ['companyName', 'dtiNumber', 'registeredAddress'],
  company_registration: ['companyName', 'tin', 'secNumber', 'registeredAddress', 'registrationDate'],
};

// Format checks per field. A scan suggestion failing its check is dropped;
// a staff read reports it as invalid instead.
const FIELD_FORMAT: Partial<Record<ReadField, { normalize?: (v: string) => string; re: RegExp }>> = {
  tin: { normalize: normalizeTin, re: TIN_REGEX },
  secNumber: { re: SEC_REGEX },
  dtiNumber: { re: DTI_REGEX },
  idNumber: { normalize: normalizePcn, re: PHILSYS_PCN_REGEX },
};

// Long free-text fields read at structurally lower confidence than a
// number or a name, so they do not count toward a document's legibility.
const LEGIBILITY_EXCLUDED = new Set<ReadField>(['address', 'registeredAddress']);

// The card prints "M"/"F" or "MALE"/"FEMALE"; the form takes the letter.
function normalizeSex(value: string): string {
  const v = value.trim();
  return /^m/i.test(v) ? 'M' : /^f/i.test(v) ? 'F' : v;
}

// OCR dates come as printed ("JANUARY 01, 1990", "1990/01/01"); the form's
// date input needs YYYY-MM-DD. Unparseable text is passed through as read.
function normalizeDate(value: string): string {
  const v = value.trim().replace(/\//g, '-');
  // Already ISO: returned as is, since Date.parse reads it as UTC midnight
  // and the local getters below would shift it a day west of Greenwich.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return value.trim();
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeRead(field: ReadField, value: string): string {
  if (field === 'sex') return normalizeSex(value);
  if (field === 'birthDate') return normalizeDate(value);
  return FIELD_FORMAT[field]?.normalize?.(value) ?? value.trim();
}

// What the customer typed on the upload, stored as customer_* keys beside
// the OCR's own keys (and decide()'s confirmed_* ones) on ocr_payload.
export type ConfirmedDocumentFields = Omit<CompanyDocumentUpload, 'documentType'>;
const CUSTOMER_KEYS: Record<keyof ConfirmedDocumentFields, string> = {
  firstName: 'customer_first_name',
  middleName: 'customer_middle_name',
  lastName: 'customer_last_name',
  idNumber: 'customer_id_number',
  birthDate: 'customer_birth_date',
  sex: 'customer_sex',
  address: 'customer_address',
  dtiNumber: 'customer_dti_number',
};

// format_valid as stored: snake_case, the keys ocr_payload uses.
function storedFormat(v: CompanyDocumentReadResponse['formatValid']) {
  return { tin: v.tin, sec_number: v.secNumber, dti_number: v.dtiNumber, id_number: v.idNumber };
}

// The keys a person wrote (customer_* at upload, confirmed_* at decide()).
function humanKeys(payload: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries((payload as Record<string, unknown> | null) ?? {}).filter(
      ([k]) => k.startsWith('customer_') || k.startsWith('confirmed_'),
    ),
  );
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly events: EventsService,
    @Inject(DOCUMENT_INTELLIGENCE_PORT) private readonly port: DocumentIntelligencePort,
    // Injected by token, not by type: an interface erases to `Object` in the
    // DI metadata, so a bare `weather: WeatherForecastPort` makes Nest look
    // for a provider called Object and refuse to construct this service at
    // boot. The default keeps the spec able to pass a counting stub.
    @Inject(WEATHER_FORECAST_PORT)
    private readonly weather: WeatherForecastPort = createWeatherAdapter(),
  ) {}

  /**
   * POST /me/kyc/scan. Reads a corporate document the customer is about to
   * upload and hands back what it saw, so the form arrives filled in and
   * they correct it rather than typing everything.
   *
   * This is a typing aid and nothing more. It writes no kyc_documents row,
   * makes no verification decision, and a value that fails its format check
   * is dropped rather than suggested -- staff still review the uploaded
   * document under RFC-2's human gate, against what the customer submitted.
   * When no extraction adapter is available the form simply opens empty.
   */
  async scanDocument(ctx: RequestContext, documentType: string, bytes: Buffer): Promise<KycScanResponse> {
    assertCustomer(ctx);
    const suggestions: KycScanResponse['suggestions'] = {
      companyName: null,
      tin: null,
      secNumber: null,
      dtiNumber: null,
      address: null,
      firstName: null,
      middleName: null,
      lastName: null,
      idNumber: null,
      birthDate: null,
      sex: null,
    };
    let result;
    try {
      result = await this.port.analyze(this.modelIdFor(documentType), bytes);
    } catch (error) {
      if (!(error instanceof ExtractionUnavailableError)) throw error;
      await this.events.emit(ctx, 'ocr_extraction_unavailable', {
        doc_type: 'kyc_scan',
        reason: error.reason,
      });
      return { suggestions, confidence: null, extractionAvailable: false };
    }
    const confidences: number[] = [];
    for (const field of SCAN_FIELDS[documentType] ?? []) {
      const read = result.fields[READ_FIELDS[field]];
      if (!read) continue;
      if (!LEGIBILITY_EXCLUDED.has(field)) confidences.push(read.confidence);
      const value = normalizeRead(field, read.value);
      if (FIELD_FORMAT[field] && !FIELD_FORMAT[field].re.test(value)) continue;
      // A certificate's registered address suggests the billing address.
      suggestions[(field === 'registeredAddress' ? 'address' : field) as keyof typeof suggestions] = value;
    }
    return {
      suggestions,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      extractionAvailable: true,
    };
  }

  async listCompanies(ctx: RequestContext): Promise<CompanyResponse[]> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => withDocuments(tx, await ownCustomers(tx, ctx)));
  }

  // A new company starts unverified: it can request quotes, but checkout
  // waits until staff approve it (payments.service.ts).
  async createCompany(ctx: RequestContext, body: CompanyCreate): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          companyName: body.companyName,
          tin: body.tin,
          secNumber: body.secNumber ?? null,
          billingAddress: body.billingAddress,
          kycStatus: 'pending',
        })
        .returning();
      if (!row) throw new Error('customers insert returned no row');
      await tx.insert(customerContacts).values({
        tenantId: ctx.tenantId,
        customerId: row.id,
        contactType: 'phone',
        contactValue: body.contactMobile,
        isPrimary: 'true',
      });
      // The National ID belongs to the login, not a company: captured once,
      // it is copied onto each new company so every review (and
      // hasRequiredCompanyDocuments) still sees it on that company.
      const [id] = await tx
        .select()
        .from(kycDocuments)
        .innerJoin(customers, eq(customers.id, kycDocuments.customerId))
        .where(
          and(
            eq(customers.userId, ctx.userId),
            eq(kycDocuments.documentType, 'government_id'),
            ne(kycDocuments.status, 'superseded'),
          ),
        )
        .orderBy(desc(kycDocuments.createdAt))
        .limit(1);
      if (id) {
        const d = id.kyc_documents;
        await tx.insert(kycDocuments).values({
          tenantId: ctx.tenantId,
          customerId: row.id,
          documentType: d.documentType,
          fileUri: d.fileUri,
          status: d.status,
          ocrPayload: d.ocrPayload,
          formatValid: d.formatValid,
          confidence: d.confidence,
        });
      }
      await this.events.emit(ctx, 'company_created', { customer_id: row.id });
      await notifyStaff(tx, ctx.tenantId, 'company_submitted', {
        customer_id: row.id,
        company_name: row.companyName,
      });
      return (await withDocuments(tx, [row]))[0]!;
    });
  }

  // PATCH /me/companies/:id. TIN and SEC number are what staff verified, so
  // they are frozen once the company is approved -- editing them would
  // silently void the check. While a submitted company waits for review it
  // is read-only except what the reviewer unlocked (comment()); saving an
  // unlocked field hands it back, locked again.
  async updateCompany(ctx: RequestContext, id: string, body: CompanyUpdate): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, id))) throw new NotFoundException({ error: 'company_not_found' });
      const [current] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
      if (!current) throw new NotFoundException({ error: 'company_not_found' });
      if (current.kycStatus === 'approved' && (body.tin !== undefined || body.secNumber !== undefined))
        throw new ConflictException({ error: 'company_verified_fields_locked' });
      const keys = Object.keys(body);
      if (current.kycStatus === 'pending' && hasRequiredCompanyDocuments(await liveDocuments(tx, id))) {
        const locked = keys.filter((key) => !current.unlockedFields.includes(key));
        if (locked.length > 0) throw new ConflictException({ error: 'company_locked', fields: locked });
      }
      if (keys.length > 0)
        await tx
          .update(customers)
          .set({ ...body, unlockedFields: current.unlockedFields.filter((f) => !keys.includes(f)) })
          .where(eq(customers.id, id));
      const [row] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
      return (await withDocuments(tx, [row!]))[0]!;
    });
  }

  // Which model a document type reads with: the registration cert asks for
  // company facts, the National ID asks for the holder's name. Shared by
  // the upload-time read and the reviewer's manual re-read, so there is
  // exactly one place that decides which model a document type gets.
  private modelIdFor(documentType: string): string {
    return documentType === 'government_id' ? NATIONAL_ID_MODEL_ID : KYC_MODEL_ID;
  }

  // One OCR pass, whichever fields its model returns. The company model
  // yields company_name/tin/sec_number/dti_number, the National ID model the
  // holder's name, PCN, birth date, sex and address -- azure-adapter.ts
  // already maps Azure's query fields to these port keys, so this reads
  // whichever keys came back rather than branching on documentType.
  private async analyzeDocument(
    ctx: RequestContext,
    documentType: string,
    bytes: Buffer,
  ): Promise<CompanyDocumentReadResponse & { ocrPayload: Record<string, unknown> }> {
    const suggestions = Object.fromEntries(
      Object.keys(READ_FIELDS).map((k) => [k, null]),
    ) as CompanyDocumentReadResponse['suggestions'];
    let result;
    try {
      result = await this.port.analyze(this.modelIdFor(documentType), bytes);
    } catch (error) {
      if (!(error instanceof ExtractionUnavailableError)) throw error;
      await this.events.emit(ctx, 'ocr_extraction_unavailable', {
        doc_type: 'company_document',
        reason: error.reason,
      });
      return {
        documentId: '',
        suggestions,
        formatValid: { tin: false, secNumber: false, dtiNumber: false, idNumber: false },
        confidence: null,
        extractionAvailable: false,
        ocrPayload: {},
      };
    }

    const ocrPayload: Record<string, unknown> = {};
    const confidences: number[] = [];
    for (const [field, key] of Object.entries(READ_FIELDS) as [ReadField, string][]) {
      const read = result.fields[key];
      // Only what this paper prints: one model serves all three
      // certificates, and its low-confidence guess at a TIN on an SEC
      // certificate is neither evidence nor a legibility signal.
      if (!read || !(SCAN_FIELDS[documentType]?.includes(field) ?? true)) continue;
      const value = normalizeRead(field, read.value);
      suggestions[field] = value;
      ocrPayload[key] = value;
      // sec_confidence, not sec_number_confidence: the key kyc.service.ts
      // and every stored row already use.
      ocrPayload[key === 'sec_number' ? 'sec_confidence' : `${key}_confidence`] = read.confidence;
      if (!LEGIBILITY_EXCLUDED.has(field)) confidences.push(read.confidence);
    }
    // Every number with a known format gets its check recorded, not only
    // the TIN and SEC number: a DTI number or PCN that fails is as much a
    // signal to the reviewer.
    const valid = (field: keyof typeof FIELD_FORMAT) => {
      const value = suggestions[field];
      return value ? FIELD_FORMAT[field]!.re.test(value) : false;
    };
    const formatValid = {
      tin: valid('tin'),
      secNumber: valid('secNumber'),
      dtiNumber: valid('dtiNumber'),
      idNumber: valid('idNumber'),
    };
    // The lowest confidence of whatever was found: a reviewer (or the
    // upload-time gate) should judge a document by its weakest field, not
    // its strongest.
    const confidence = confidences.length > 0 ? Math.min(...confidences) : null;

    return { documentId: '', suggestions, formatValid, confidence, extractionAvailable: true, ocrPayload };
  }

  // The file is already validated and in storage (controller); this
  // records it against a company the caller owns, then reads it with the
  // same OCR pass a reviewer would later trigger manually, and it goes to
  // the staff queue ('needs_review') however well it read. Nothing is
  // bounced back automatically: a reviewer who cannot use it says so with
  // comment(), which unlocks that document for a re-upload. A document type
  // already on file is replaced only when unlocked; the old row is kept as
  // 'superseded' evidence. Verification stays decide()'s call (RFC-2).
  async addDocument(
    ctx: RequestContext,
    customerId: string,
    documentType: string,
    fileUri: string,
    bytes: Buffer,
    confirmed: ConfirmedDocumentFields = {},
  ) {
    assertCustomer(ctx);
    // What the customer checked on screen, kept even when OCR is off so the
    // reviewer still sees the PCN they typed.
    const customerPayload = Object.fromEntries(
      (Object.entries(confirmed) as [keyof ConfirmedDocumentFields, string | undefined][])
        .filter(([k, v]) => v && CUSTOMER_KEYS[k])
        .map(([k, v]) => [CUSTOMER_KEYS[k], v]),
    );
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId)))
        throw new NotFoundException({ error: 'company_not_found' });
      const onFile = (await liveDocuments(tx, customerId)).some((d) => d.documentType === documentType);
      if (onFile) {
        const [company] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
        if (!company?.unlockedFields.includes(documentType))
          throw new ConflictException({ error: 'document_locked' });
        await tx
          .update(kycDocuments)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(kycDocuments.customerId, customerId),
              eq(kycDocuments.documentType, documentType),
              ne(kycDocuments.status, 'superseded'),
            ),
          );
        await tx
          .update(customers)
          .set({ unlockedFields: company.unlockedFields.filter((f) => f !== documentType) })
          .where(eq(customers.id, customerId));
      }
      const [row] = await tx
        .insert(kycDocuments)
        .values({
          tenantId: ctx.tenantId,
          customerId,
          documentType,
          fileUri,
          status: 'pending',
          ...(Object.keys(customerPayload).length > 0 ? { ocrPayload: customerPayload } : {}),
        })
        .returning();
      if (!row) throw new Error('kyc_documents insert returned no row');

      const read = await this.analyzeDocument(ctx, documentType, bytes);
      let status = row.status;
      if (read.extractionAvailable) {
        status = 'needs_review';
        await tx
          .update(kycDocuments)
          .set({
            ocrPayload: { ...read.ocrPayload, ...customerPayload },
            formatValid: storedFormat(read.formatValid),
            ...(read.confidence === null ? {} : { confidence: read.confidence.toFixed(4) }),
            status,
          })
          .where(eq(kycDocuments.id, row.id));
      }

      return {
        id: row.id,
        documentType: row.documentType,
        status,
        createdAt: row.createdAt,
      };
    });
  }

  async listSites(ctx: RequestContext): Promise<CustomerSiteResponse[]> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      const ids = (await ownCustomers(tx, ctx)).map((row) => row.id);
      if (ids.length === 0) return [];
      const rows = await tx
        .select({ site: projectSites, address: addresses })
        .from(projectSites)
        .innerJoin(addresses, eq(addresses.id, projectSites.addressId))
        .where(inArray(projectSites.customerId, ids))
        .orderBy(desc(projectSites.createdAt));
      return rows.map(({ site, address }) => toSite(site, address));
    });
  }

  /**
   * GET /me/sites/:id/forecast. Five days for one of the caller's own sites.
   *
   * The weather routes on sites.controller.ts are STAFF_READ, so a customer
   * could not read weather at all -- this is the customer's own surface, and
   * it is bounded the same way every other /me read is. RLS puts every
   * customer of a tenant in one scope; ownCustomers() on top is what stops
   * one customer reading the forecast for another's site, which would leak
   * where that company is working (audit-api-surface.md #1).
   */
  async siteForecast(ctx: RequestContext, siteId: string): Promise<SiteForecastResponse> {
    assertCustomer(ctx);
    const site = await withTenantTx(ctx, async (tx) => {
      const ids = (await ownCustomers(tx, ctx)).map((row) => row.id);
      if (ids.length === 0) throw new NotFoundException({ error: 'site_not_found' });
      const [row] = await tx
        .select()
        .from(projectSites)
        .where(and(eq(projectSites.id, siteId), inArray(projectSites.customerId, ids)))
        .limit(1);
      // Not-found rather than forbidden, so the check confirms no ids.
      if (!row) throw new NotFoundException({ error: 'site_not_found' });
      return row;
    });

    const latitude = Number(site.latitude);
    const longitude = Number(site.longitude);
    const cached = readForecastCache(latitude, longitude);
    if (cached) return { siteId, days: cached.days, fetchedAt: cached.fetchedAt };

    let days;
    try {
      days = await this.weather.getForecast(latitude, longitude);
    } catch (err) {
      // Unavailable is reported as unavailable. Never an empty week, never
      // zeros: packages/shared/src/weather-port.spec.ts pins why a
      // fabricated all-clear is the one failure mode that can hurt someone.
      throw new ServiceUnavailableException({
        error: 'weather_unavailable',
        reason: err instanceof WeatherUnavailableError ? err.reason : 'upstream_failed',
      });
    }

    const fetchedAt = new Date().toISOString();
    writeForecastCache(latitude, longitude, days, fetchedAt);
    return { siteId, days, fetchedAt };
  }

  async createSite(ctx: RequestContext, body: CustomerSiteCreate): Promise<CustomerSiteResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, body.customerId)))
        throw new NotFoundException({ error: 'company_not_found' });
      const [address] = await tx
        .insert(addresses)
        .values({
          tenantId: ctx.tenantId,
          line1: body.line1,
          city: body.city,
          province: body.province,
        })
        .returning();
      if (!address) throw new Error('addresses insert returned no row');
      const [site] = await tx
        .insert(projectSites)
        .values({
          tenantId: ctx.tenantId,
          addressId: address.id,
          customerId: body.customerId,
          latitude: String(body.latitude),
          longitude: String(body.longitude),
        })
        .returning();
      if (!site) throw new Error('project_sites insert returned no row');
      await this.events.emit(ctx, 'customer_site_created', { project_site_id: site.id });
      return toSite(site, address);
    });
  }

  // --- Staff verification queue (kyc:verify).

  // Each document carries its stored reads, so the reviewer sees what the
  // upload-time OCR and the customer said without a click (or an Azure
  // spend); "Re-read" stays for a fresh pass.
  async listForReview(ctx: RequestContext, kycStatus: string): Promise<CompanyReviewResponse[]> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(eq(customers.kycStatus, kycStatus))
        .orderBy(desc(customers.createdAt))
        .limit(100);
      return withDocuments(tx, rows, true);
    });
  }

  /**
   * GET /me/companies/:id/documents/:documentId/url. The customer's own
   * copy of documentKey().
   *
   * RLS bounds the tenant and nothing more, and `customer` is an
   * intra-tenant role -- without ownsCustomer() on top, one customer of a
   * tenant could read another's registration certificate by guessing a
   * customer id (audit-api-surface.md #1). Refuses as not-found rather
   * than forbidden so the check leaks no ids.
   */
  async ownDocumentKey(ctx: RequestContext, customerId: string, documentId: string): Promise<string> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId))) {
        throw new NotFoundException({ error: 'document_not_found' });
      }
      const [doc] = await tx
        .select()
        .from(kycDocuments)
        .where(and(eq(kycDocuments.id, documentId), eq(kycDocuments.customerId, customerId)))
        .limit(1);
      if (!doc) throw new NotFoundException({ error: 'document_not_found' });
      return doc.fileUri;
    });
  }

  async documentKey(ctx: RequestContext, customerId: string, documentId: string): Promise<string> {
    return withTenantTx(ctx, async (tx) => {
      const [doc] = await tx
        .select()
        .from(kycDocuments)
        .where(and(eq(kycDocuments.id, documentId), eq(kycDocuments.customerId, customerId)))
        .limit(1);
      if (!doc) throw new NotFoundException({ error: 'document_not_found' });
      return doc.fileUri;
    });
  }

  /**
   * POST /customers/:id/documents/:documentId/read. A reviewer's "Read
   * document" click: extracts what it can from the document already in
   * storage and saves it on the row as evidence.
   *
   * It decides nothing. `kyc_status` is untouched, the values land in
   * `ocr_payload`/`format_valid`/`confidence` for the reviewer to edit, and
   * approval stays the explicit decide() call (RFC-2's human gate). A value
   * failing its format check is reported as invalid rather than hidden: a
   * reviewer told "TIN read as 12-34, format invalid" is better informed
   * than one shown nothing.
   */
  async readDocument(
    ctx: RequestContext,
    customerId: string,
    documentId: string,
    bytes: Buffer,
  ): Promise<CompanyDocumentReadResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [doc] = await tx
        .select()
        .from(kycDocuments)
        .where(and(eq(kycDocuments.id, documentId), eq(kycDocuments.customerId, customerId)))
        .limit(1);
      if (!doc) throw new NotFoundException({ error: 'document_not_found' });

      const read = await this.analyzeDocument(ctx, doc.documentType, bytes);
      if (read.extractionAvailable) {
        await tx
          .update(kycDocuments)
          .set({
            // A re-read replaces the OCR's keys, never what the customer or
            // a reviewer confirmed.
            ocrPayload: { ...read.ocrPayload, ...humanKeys(doc.ocrPayload) },
            formatValid: storedFormat(read.formatValid),
            ...(read.confidence === null ? {} : { confidence: read.confidence.toFixed(4) }),
            status: 'needs_review', // never 'verified': that is decide()'s to set
          })
          .where(eq(kycDocuments.id, documentId));
      }

      return { ...read, documentId };
    });
  }

  // PATCH /customers/:id/review. The reviewer's note to the customer on a
  // pending company, unlocking just the fields and documents it names. The
  // status stays pending (only decide() moves it); the customer is told in
  // their feed.
  async comment(ctx: RequestContext, customerId: string, body: CompanyReviewComment) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'company_not_found' });
      if (row.kycStatus !== 'pending') throw new ConflictException({ error: 'already_decided' });
      const unlockedFields = [...new Set(body.unlock)];
      await tx
        .update(customers)
        .set({ reviewComment: body.comment, unlockedFields })
        .where(eq(customers.id, customerId));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'customers',
        entityId: customerId,
      });
      if (row.userId) {
        await tx.insert(notifications).values({
          tenantId: ctx.tenantId,
          userId: row.userId,
          notificationType: 'company_review_comment',
          payload: { company_id: customerId, company_name: row.companyName, comment: body.comment },
        });
      }
      return { id: customerId, kycStatus: row.kycStatus, reviewComment: body.comment, unlockedFields };
    });
  }

  // Verification is a human decision on the uploaded ID and registration.
  // OCR never reaches this: a corrected value here was confirmed by the
  // reviewer with the document in front of them.
  async decide(ctx: RequestContext, customerId: string, body: CompanyDecision) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'company_not_found' });
      if (row.kycStatus === body.decision)
        throw new ConflictException({ error: 'already_decided' });

      const docs = await liveDocuments(tx, customerId);
      // Every SEC, 2303 and DTI paper is checked on its public registry by a
      // human before approval: the reviewer ticks each one, and a missed
      // tick refuses the approval rather than silently verifying.
      const registryDocs = docs.filter((d) =>
        (REGISTRY_DOCUMENT_TYPES as readonly string[]).includes(d.documentType),
      );
      const checked = new Set(body.registryChecked ?? []);
      const unchecked = registryDocs.filter((d) => !checked.has(d.id));
      if (body.decision === 'approved' && unchecked.length > 0) {
        throw new ConflictException({
          error: 'registry_check_required',
          documentTypes: unchecked.map((d) => d.documentType),
        });
      }

      // Approving with corrections writes what the reviewer confirmed
      // against the document, so a verified company carries the registered
      // name and TIN rather than whatever was typed at signup.
      const corrections =
        body.decision === 'approved'
          ? {
              ...(body.companyName ? { companyName: body.companyName } : {}),
              ...(body.tin ? { tin: body.tin } : {}),
              ...(body.secNumber ? { secNumber: body.secNumber } : {}),
            }
          : {};
      await tx
        .update(customers)
        .set({ kycStatus: body.decision, reviewComment: null, unlockedFields: [], ...corrections })
        .where(eq(customers.id, customerId));
      // The reviewer-confirmed legal name off the National ID lands on the
      // customer's own user account, not the company row -- it is the
      // person's identity, not a fact about this one company (RFC-2's human
      // gate: only decide() ever writes it, never the OCR read itself).
      if (body.decision === 'approved' && row.userId && (body.firstName || body.lastName)) {
        await tx
          .update(users)
          .set({
            ...(body.firstName ? { firstName: body.firstName } : {}),
            ...(body.middleName ? { middleName: body.middleName } : {}),
            ...(body.lastName ? { lastName: body.lastName } : {}),
          })
          .where(eq(users.id, row.userId));
      }
      // The company has no DTI column (the number belongs to the business
      // name, not the company); the reviewer-confirmed one is evidence on
      // the DTI certificate it was read from.
      const dti = docs.find((d) => d.documentType === 'dti_certificate');
      if (body.decision === 'approved' && body.dtiNumber && dti) {
        await tx
          .update(kycDocuments)
          .set({
            ocrPayload: {
              ...(dti.ocrPayload as Record<string, unknown> | null),
              confirmed_dti_number: body.dtiNumber,
              confirmed_by: ctx.userId,
            },
          })
          .where(eq(kycDocuments.id, dti.id));
      }
      if (body.decision === 'approved' && registryDocs.length > 0) {
        await tx
          .update(kycDocuments)
          .set({ registryStatus: 'active' })
          .where(inArray(kycDocuments.id, registryDocs.map((d) => d.id)));
      }
      await tx
        .update(kycDocuments)
        .set({ status: body.decision === 'approved' ? 'verified' : 'rejected' })
        .where(and(eq(kycDocuments.customerId, customerId), ne(kycDocuments.status, 'superseded')));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: body.decision === 'approved' ? 'APPROVE' : 'REJECT',
        entity: 'customers',
        entityId: customerId,
      });
      if (row.userId) {
        await tx.insert(notifications).values({
          tenantId: ctx.tenantId,
          userId: row.userId,
          notificationType: body.decision === 'approved' ? 'company_verified' : 'company_rejected',
          payload: { customer_id: customerId, company_name: row.companyName },
        });
      }
      return { id: customerId, kycStatus: body.decision };
    });
  }
}

// /me/* is the customer's own workspace. Staff act on customers through
// the review endpoints, never by creating companies under their own login.
function assertCustomer(ctx: RequestContext) {
  if (ctx.role !== 'customer') throw new ForbiddenException({ error: 'customer_only' });
}

function toCompany(
  row: typeof customers.$inferSelect,
  name?: { firstName: string | null; middleName: string | null; lastName: string | null },
): Omit<CompanyResponse, 'documents'> {
  return {
    id: row.id,
    companyName: row.companyName,
    tin: row.tin,
    secNumber: row.secNumber,
    billingAddress: row.billingAddress,
    kycStatus: row.kycStatus,
    reviewComment: row.reviewComment,
    unlockedFields: row.unlockedFields,
    firstName: name?.firstName ?? null,
    middleName: name?.middleName ?? null,
    lastName: name?.lastName ?? null,
    createdAt: row.createdAt,
  };
}

// The confirmed legal name lives on the linked user's account (decide()),
// not on the company row -- one login can register several companies and
// the name follows the login, not any one of them.
async function withUserNames(tx: Tx, rows: (typeof customers.$inferSelect)[]) {
  const userIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => !!id))];
  if (userIds.length === 0) return new Map<string, typeof users.$inferSelect>();
  const rows_ = await tx.select().from(users).where(inArray(users.id, userIds));
  return new Map(rows_.map((u) => [u.id, u]));
}

async function withDocuments(tx: Tx, rows: (typeof customers.$inferSelect)[]): Promise<CompanyResponse[]>;
async function withDocuments(
  tx: Tx,
  rows: (typeof customers.$inferSelect)[],
  withReads: true,
): Promise<CompanyReviewResponse[]>;
async function withDocuments(
  tx: Tx,
  rows: (typeof customers.$inferSelect)[],
  withReads = false,
): Promise<CompanyResponse[] | CompanyReviewResponse[]> {
  if (rows.length === 0) return [];
  const [docs, names] = await Promise.all([
    tx
      .select()
      .from(kycDocuments)
      .where(
        and(
          inArray(
            kycDocuments.customerId,
            rows.map((row) => row.id),
          ),
          ne(kycDocuments.status, 'superseded'),
        ),
      )
      .orderBy(desc(kycDocuments.createdAt)),
    withUserNames(tx, rows),
  ]);
  return rows.map((row) => ({
    ...toCompany(row, row.userId ? names.get(row.userId) : undefined),
    documents: docs
      .filter((doc) => doc.customerId === row.id)
      .map((doc) => ({
        id: doc.id,
        documentType: doc.documentType,
        // Documents are no longer bounced back; an old row still carrying
        // that status reads as waiting like any other.
        status: doc.status === 'resubmit_required' ? 'pending' : doc.status,
        createdAt: doc.createdAt,
        ...(withReads ? documentReads(doc) : {}),
      })),
  }));
}

// A company's current documents: a re-upload leaves the one it replaced
// behind as 'superseded' evidence, which no longer counts.
function liveDocuments(tx: Tx, customerId: string) {
  return tx
    .select()
    .from(kycDocuments)
    .where(and(eq(kycDocuments.customerId, customerId), ne(kycDocuments.status, 'superseded')));
}

// ocr_payload split for the reviewer: the OCR's own string values, and the
// customer's (customer_* keys, prefix dropped). Per-field confidences stay
// server-side; the document-level one is enough to judge by.
function documentReads(doc: typeof kycDocuments.$inferSelect) {
  const ocr: Record<string, string> = {};
  const customer: Record<string, string> = {};
  for (const [key, value] of Object.entries((doc.ocrPayload as Record<string, unknown> | null) ?? {})) {
    if (typeof value !== 'string' || key.endsWith('_confidence') || key.startsWith('confirmed_')) continue;
    if (key.startsWith('customer_')) customer[key.slice('customer_'.length)] = value;
    else ocr[key] = value;
  }
  return {
    confidence: doc.confidence === null ? null : Number(doc.confidence),
    ocr,
    customer,
    registryChecked: doc.registryStatus === 'active',
  };
}

function toSite(
  site: typeof projectSites.$inferSelect,
  address: typeof addresses.$inferSelect,
): CustomerSiteResponse {
  return {
    id: site.id,
    customerId: site.customerId!,
    line1: address.line1,
    city: address.city,
    province: address.province,
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
  };
}
