import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  type Tx,
  addresses,
  auditLogs,
  customerContacts,
  customers,
  kycDocuments,
  notifications,
  projectSites,
  rentals,
  siteDocuments,
  users,
  withTenantTx,
} from '@arkilaunch/db';
import {
  onLuzonMainland,
  DTI_REGEX,
  manilaDate,
  ExtractionUnavailableError,
  findSameCompany,
  hasRequiredCompanyDocuments,
  scoreRegistration,
  idTypeOf,
  PH_ID_TYPES,
  type PhIdTypeCode,
  normalizeSecNumber,
  normalizeTin,
  parseCertificateDate,
  parseRegistrationCertificate,
  REGISTRY_DOCUMENT_TYPES,
  SEC_REGEX,
  TIN_REGEX,
  type CompanyDocumentReadResponse,
  type CompanyDocumentUpload,
  cureDocumentsFor,
  isOcrDocument,
  KYC_REJECTION_REASONS,
  type KycRejectionReason,
  type CompanyReviewListResponse,
  type CompanyReviewResponse,
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
  type KycScanResponse,
  type AreaForecastResponse,
  type SiteEquipmentWeatherResponse,
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
import { ownCustomers, ownsCustomer, ownSite } from '../common/customer-scope.js';
import { EventsService } from '../events/events.service.js';
import { notifyStaff } from '../common/notify-customer.js';
import { siteDocumentsFor, siteProofComplete } from '../common/site-proof.js';
import { latestEquipmentWeather } from '../common/equipment-weather.js';
import { countRows } from '../common/count-rows.js';


// RLS bounds the tenant; ownCustomers() bounds a customer to their own companies.

// Cached by ~100 m coordinates, successes only: customers trigger this route and the free-tier budget was sized for the poller.
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

export function __clearForecastCache(): void {
  forecastCache.clear();
}

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

const SCAN_FIELDS: Record<string, ReadField[]> = {
  government_id: ['firstName', 'middleName', 'lastName', 'idNumber', 'birthDate', 'sex', 'address'],
  // No address: an SEC certificate prints only the SEC's own letterhead address.
  sec_certificate: ['companyName', 'secNumber', 'registrationDate'],
  bir_cor: ['companyName', 'tin', 'registeredAddress', 'registrationDate'],
  dti_certificate: ['companyName', 'dtiNumber', 'registeredAddress'],
  company_registration: ['companyName', 'tin', 'secNumber', 'registeredAddress', 'registrationDate'],
};

type FieldFormat = { normalize?: (v: string) => string; re: RegExp };
const FIELD_FORMAT: Partial<Record<ReadField, FieldFormat>> = {
  tin: { normalize: normalizeTin, re: TIN_REGEX },
  secNumber: { normalize: normalizeSecNumber, re: SEC_REGEX },
  dtiNumber: { re: DTI_REGEX },
};
function formatOf(field: ReadField, idType: PhIdTypeCode): FieldFormat | undefined {
  return field === 'idNumber' ? PH_ID_TYPES[idType] : FIELD_FORMAT[field];
}

// Long free text reads at structurally lower confidence, so it doesn't count toward legibility.
const LEGIBILITY_EXCLUDED = new Set<ReadField>(['address', 'registeredAddress']);

// The scan hint also skips middle name (often blank) and PhilSys sex (not printed). The staff
// read keeps them: its confidence feeds the RFC-2 review gate.
const scanHintExcluded = (field: ReadField, idType: PhIdTypeCode) =>
  LEGIBILITY_EXCLUDED.has(field) || field === 'middleName' || (field === 'sex' && idType === 'philsys');

function normalizeSex(value: string): string {
  const v = value.trim();
  return /^m/i.test(v) ? 'M' : /^f/i.test(v) ? 'F' : v;
}

function normalizeDate(value: string): string {
  const v = value.trim().replace(/\//g, '-');
  // Date.parse reads ISO as UTC midnight; the local getters below would shift it a day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return value.trim();
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeRead(field: ReadField, value: string, idType: PhIdTypeCode): string {
  if (field === 'sex') return normalizeSex(value);
  if (field === 'birthDate') return normalizeDate(value);
  if (field === 'registrationDate') return parseCertificateDate(value) ?? value.trim();
  if (field === 'companyName' || field === 'registeredAddress') return value.replace(/\s+/g, ' ').trim();
  return formatOf(field, idType)?.normalize?.(value) ?? value.trim();
}

type CertificateLayout = 'sec_coi' | 'bir_2303' | 'unrecognized';

function readCertificate(
  documentType: string,
  result: DocumentExtractionResult,
): { fields: DocumentExtractionResult['fields']; layout: CertificateLayout | null } {
  if (!result.text || (documentType !== 'sec_certificate' && documentType !== 'bir_cor')) {
    return { fields: result.fields, layout: null };
  }
  const parsed = parseRegistrationCertificate(documentType, result.text);
  const fallback = { ...result.fields };
  // On a recognised SEC certificate the queried date is the Corporation Code's effectivity date, not evidence.
  if (parsed.layout === 'sec_coi') delete fallback.registration_date;
  return { fields: { ...fallback, ...parsed.fields }, layout: parsed.layout ?? 'unrecognized' };
}

export type ConfirmedDocumentFields = Omit<CompanyDocumentUpload, 'documentType'>;
const CUSTOMER_KEYS: Record<keyof ConfirmedDocumentFields, string> = {
  firstName: 'customer_first_name',
  middleName: 'customer_middle_name',
  lastName: 'customer_last_name',
  idNumber: 'customer_id_number',
  idType: 'customer_id_type',
  birthDate: 'customer_birth_date',
  sex: 'customer_sex',
  address: 'customer_address',
  dtiNumber: 'customer_dti_number',
};

function storedFormat(v: CompanyDocumentReadResponse['formatValid']) {
  return { tin: v.tin, sec_number: v.secNumber, dti_number: v.dtiNumber, id_number: v.idNumber };
}

function humanKeys(payload: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries((payload as Record<string, unknown> | null) ?? {}).filter(
      ([k]) => k.startsWith('customer_') || k.startsWith('confirmed_'),
    ),
  );
}

// Scan and upload send the same bytes, so the upload reuses the server's own read (per login + file hash).
// ponytail: per-instance Map; a miss just runs OCR again. Move to Redis if the API scales out wide.
const OCR_CACHE_TTL_MS = 30 * 60_000;
const OCR_CACHE_MAX = 200;

@Injectable()
export class CustomersService {
  private readonly ocrCache = new Map<string, { at: number; result: Promise<DocumentExtractionResult> }>();

  constructor(
    private readonly events: EventsService,
    @Inject(DOCUMENT_INTELLIGENCE_PORT) private readonly port: DocumentIntelligencePort,
    // Injected by token: an interface erases to Object in DI metadata and Nest refuses to boot.
    @Inject(WEATHER_FORECAST_PORT)
    private readonly weather: WeatherForecastPort = createWeatherAdapter(),
  ) {}

  /** Typing aid only: writes no row and decides nothing; staff still review under the RFC-2 human gate. */
  async scanDocument(
    ctx: RequestContext,
    documentType: string,
    bytes: Buffer,
    idType: PhIdTypeCode = 'philsys',
  ): Promise<KycScanResponse> {
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
      result = await this.analyzeCached(ctx, this.modelIdFor(documentType), bytes);
    } catch (error) {
      if (!(error instanceof ExtractionUnavailableError)) throw error;
      await this.events.emit(ctx, 'ocr_extraction_unavailable', {
        doc_type: 'kyc_scan',
        reason: error.reason,
      });
      return { suggestions, confidence: null, extractionAvailable: false, layoutRecognized: null };
    }
    const { fields, layout } = readCertificate(documentType, result);
    const confidences: number[] = [];
    for (const field of SCAN_FIELDS[documentType] ?? []) {
      const read = fields[READ_FIELDS[field]];
      // The form takes no registration date; the staff read keeps it.
      if (!read || (field !== 'registeredAddress' && !(field in suggestions))) continue;
      const value = normalizeRead(field, read.value, idType);
      const format = formatOf(field, idType);
      if (format && !format.re.test(value)) continue;
      if (!scanHintExcluded(field, idType)) confidences.push(read.confidence);
      suggestions[(field === 'registeredAddress' ? 'address' : field) as keyof typeof suggestions] = value;
    }
    return {
      suggestions,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      extractionAvailable: true,
      layoutRecognized: layout === null ? null : layout !== 'unrecognized',
    };
  }

  async listCompanies(ctx: RequestContext): Promise<CompanyResponse[]> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => withDocuments(tx, await ownCustomers(tx, ctx)));
  }

  // Starts unverified: quotes are allowed, checkout waits for staff approval.
  async createCompany(ctx: RequestContext, body: CompanyCreate): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      const same = findSameCompany(body, await ownCustomers(tx, ctx));
      if (same) {
        throw new ConflictException({ error: 'company_already_applied', companyId: same.id, status: same.kycStatus });
      }
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
      // The login's National ID is copied onto each new company so every review sees it.
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

  // TIN/SEC freeze once approved (editing would void the check); a complete pending application is read-only.
  async updateCompany(ctx: RequestContext, id: string, body: CompanyUpdate): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, id))) throw new NotFoundException({ error: 'company_not_found' });
      const [current] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
      if (!current) throw new NotFoundException({ error: 'company_not_found' });
      if (current.kycStatus === 'approved' && (body.tin !== undefined || body.secNumber !== undefined))
        throw new ConflictException({ error: 'company_verified_fields_locked' });
      const live = await liveDocuments(tx, id);
      // A scanned SEC certificate owns the number: the upload copies the read onto the company.
      if (body.secNumber !== undefined && live.some((d) => d.documentType === 'sec_certificate'))
        throw new ConflictException({ error: 'sec_number_from_document' });
      const keys = Object.keys(body);
      if (keys.length > 0 && current.kycStatus === 'pending' && hasRequiredCompanyDocuments(live))
        throw new ConflictException({ error: 'company_locked', fields: keys });
      if (keys.length > 0 && isFinalRejection(current)) throw new ConflictException({ error: 'rejection_final' });
      if (keys.length > 0) await tx.update(customers).set(body).where(eq(customers.id, id));
      const [row] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
      return (await withDocuments(tx, [row!]))[0]!;
    });
  }

  private modelIdFor(documentType: string): string {
    return documentType === 'government_id' ? NATIONAL_ID_MODEL_ID : KYC_MODEL_ID;
  }

  private analyzeCached(ctx: RequestContext, modelId: string, bytes: Buffer): Promise<DocumentExtractionResult> {
    const key = `${ctx.tenantId}:${ctx.userId}:${modelId}:${createHash('sha256').update(bytes).digest('hex')}`;
    const now = Date.now();
    const ocrCache = this.ocrCache;
    const hit = ocrCache.get(key);
    if (hit && now - hit.at < OCR_CACHE_TTL_MS) return hit.result;
    const result = this.port.analyze(modelId, bytes);
    result.catch(() => ocrCache.delete(key));
    ocrCache.set(key, { at: now, result });
    while (ocrCache.size > OCR_CACHE_MAX) ocrCache.delete(ocrCache.keys().next().value!);
    return result;
  }

  private async analyzeDocument(
    ctx: RequestContext,
    documentType: string,
    bytes: Buffer,
    cached = true,
    idType: PhIdTypeCode = 'philsys',
  ): Promise<CompanyDocumentReadResponse & { ocrPayload: Record<string, unknown> }> {
    const suggestions = Object.fromEntries(
      Object.keys(READ_FIELDS).map((k) => [k, null]),
    ) as CompanyDocumentReadResponse['suggestions'];
    let result;
    try {
      const modelId = this.modelIdFor(documentType);
      result = await (cached ? this.analyzeCached(ctx, modelId, bytes) : this.port.analyze(modelId, bytes));
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

    const { fields, layout } = readCertificate(documentType, result);
    const ocrPayload: Record<string, unknown> = layout ? { layout } : {};
    const confidences: number[] = [];
    for (const [field, key] of Object.entries(READ_FIELDS) as [ReadField, string][]) {
      const read = fields[key];
      // Only what this paper prints: one model reads all three certificates and guesses at the rest.
      if (!read || !(SCAN_FIELDS[documentType]?.includes(field) ?? true)) continue;
      const value = normalizeRead(field, read.value, idType);
      suggestions[field] = value;
      ocrPayload[key] = value;
      // sec_confidence, not sec_number_confidence: the key stored rows already use.
      ocrPayload[key === 'sec_number' ? 'sec_confidence' : `${key}_confidence`] = read.confidence;
      if (!LEGIBILITY_EXCLUDED.has(field)) confidences.push(read.confidence);
    }
    const valid = (field: 'tin' | 'secNumber' | 'dtiNumber' | 'idNumber') => {
      const value = suggestions[field];
      return value ? formatOf(field, idType)!.re.test(value) : false;
    };
    const formatValid = {
      tin: valid('tin'),
      secNumber: valid('secNumber'),
      dtiNumber: valid('dtiNumber'),
      idNumber: valid('idNumber'),
    };
    const confidence = confidences.length > 0 ? Math.min(...confidences) : null;

    return { documentId: '', suggestions, formatValid, confidence, extractionAvailable: true, ocrPayload };
  }

  // Every OCR'd document lands in 'needs_review'; verification stays decide()'s call.
  async addDocument(
    ctx: RequestContext,
    customerId: string,
    documentType: string,
    fileUri: string,
    bytes: Buffer,
    confirmed: ConfirmedDocumentFields = {},
  ) {
    assertCustomer(ctx);
    const customerPayload = Object.fromEntries(
      (Object.entries(confirmed) as [keyof ConfirmedDocumentFields, string | undefined][])
        .filter(([k, v]) => v && CUSTOMER_KEYS[k])
        .map(([k, v]) => [CUSTOMER_KEYS[k], v]),
    );
    // OCR runs after this tx commits: a slow Azure call must not hold a pooled connection.
    const row = await withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId)))
        throw new NotFoundException({ error: 'company_not_found' });
      const live = await liveDocuments(tx, customerId);
      const onFile = live.some((d) => d.documentType === documentType);
      const [company] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (company && isFinalRejection(company)) throw new ConflictException({ error: 'rejection_final' });
      // A submitted or verified company's papers are what was reviewed, so they stay (a rejection may be cured).
      if (onFile && company?.kycStatus !== 'rejected' && hasRequiredCompanyDocuments(live))
        throw new ConflictException({ error: 'document_locked' });
      if (onFile) {
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

      // Cure papers (and old selfies) go to a person only.
      if (!isOcrDocument(documentType)) {
        await tx.update(kycDocuments).set({ status: 'needs_review' }).where(eq(kycDocuments.id, row.id));
        return { ...row, status: 'needs_review' };
      }
      return row;
    });
    if (!isOcrDocument(documentType)) {
      return { id: row.id, documentType: row.documentType, status: row.status, createdAt: row.createdAt };
    }

    // A failed read leaves the row 'pending' for the reviewer's re-read.
    const read = await this.analyzeDocument(ctx, documentType, bytes, true, idTypeOf(confirmed.idType));
    let status = row.status;
    if (read.extractionAvailable) {
      status = 'needs_review';
      await withTenantTx(ctx, async (tx) => {
        await tx
          .update(kycDocuments)
          .set({
            ocrPayload: { ...read.ocrPayload, ...customerPayload },
            formatValid: storedFormat(read.formatValid),
            ...(read.confidence === null ? {} : { confidence: read.confidence.toFixed(4) }),
            status,
          })
          .where(eq(kycDocuments.id, row.id));
        // The certificate's number wins over what was typed; a verified company's number stays frozen.
        if (documentType === 'sec_certificate' && read.formatValid.secNumber)
          await tx
            .update(customers)
            .set({ secNumber: read.suggestions.secNumber })
            .where(and(eq(customers.id, customerId), ne(customers.kycStatus, 'approved')));
      });
    }

    return {
      id: row.id,
      documentType: row.documentType,
      status,
      createdAt: row.createdAt,
    };
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
      const docs = await siteDocumentsFor(tx, rows.map(({ site }) => site.id));
      return rows.map(({ site, address }) => toSite(site, address, docs.get(site.id)));
    });
  }

  async ownSitePhotoKey(ctx: RequestContext, siteId: string): Promise<string | null> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      await ownSite(tx, ctx, siteId);
      const [photo] = await tx.select({ fileUri: siteDocuments.fileUri }).from(siteDocuments)
        .where(and(eq(siteDocuments.projectSiteId, siteId), eq(siteDocuments.documentType, 'site_photo'), ne(siteDocuments.status, 'rejected')))
        .orderBy(desc(siteDocuments.createdAt)).limit(1);
      return photo?.fileUri ?? null;
    });
  }

  // Never sent to OCR; a person looks at it.
  async addSiteDocument(ctx: RequestContext, siteId: string, documentType: string, fileUri: string) {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      await ownSite(tx, ctx, siteId);
      const [row] = await tx
        .insert(siteDocuments)
        .values({ tenantId: ctx.tenantId, projectSiteId: siteId, documentType, fileUri, uploadedBy: ctx.userId })
        .returning();
      if (!row) throw new Error('site_documents insert returned no row');
      const docs = (await siteDocumentsFor(tx, [siteId])).get(siteId) ?? [];
      return { id: row.id, documentType: row.documentType, status: row.status, createdAt: row.createdAt, proofComplete: siteProofComplete(docs) };
    });
  }

  async listSiteDocuments(ctx: RequestContext, siteId: string) {
    return withTenantTx(ctx, async (tx) => {
      const docs = (await siteDocumentsFor(tx, [siteId])).get(siteId) ?? [];
      return { projectSiteId: siteId, documents: docs, proofComplete: siteProofComplete(docs) };
    });
  }

  // The storage key for a signed URL, re-read under RLS, never from the client.
  async siteDocumentKey(ctx: RequestContext, siteId: string, documentId: string): Promise<string> {
    return withTenantTx(ctx, async (tx) => {
      const [doc] = await tx
        .select()
        .from(siteDocuments)
        .where(and(eq(siteDocuments.id, documentId), eq(siteDocuments.projectSiteId, siteId)))
        .limit(1);
      if (!doc) throw new NotFoundException({ error: 'document_not_found' });
      return doc.fileUri;
    });
  }

  // ownSite() on top of RLS: every customer of a tenant shares one RLS scope.
  async siteForecast(ctx: RequestContext, siteId: string): Promise<SiteForecastResponse> {
    assertCustomer(ctx);
    const { site } = await withTenantTx(ctx, (tx) => ownSite(tx, ctx, siteId));

    return { siteId, ...(await this.forecastAt(Number(site.latitude), Number(site.longitude))) };
  }

  async areaForecast(ctx: RequestContext): Promise<AreaForecastResponse> {
    assertCustomer(ctx);
    return { area: 'Metro Manila', ...(await this.forecastAt(14.5995, 120.9842)) };
  }

  private async forecastAt(latitude: number, longitude: number): Promise<{ days: DailyForecast[]; fetchedAt: string }> {
    const cached = readForecastCache(latitude, longitude);
    if (cached) return { days: cached.days, fetchedAt: cached.fetchedAt };

    let days;
    try {
      days = await this.weather.getForecast(latitude, longitude);
    } catch (err) {
      // Unavailable is reported as unavailable; a fabricated all-clear is the one failure that can hurt someone.
      throw new ServiceUnavailableException({
        error: 'weather_unavailable',
        reason: err instanceof WeatherUnavailableError ? err.reason : 'upstream_failed',
      });
    }

    const fetchedAt = new Date().toISOString();
    writeForecastCache(latitude, longitude, days, fetchedAt);
    return { days, fetchedAt };
  }

  // Only the caller's own machines on the site, never a neighbour's.
  async siteEquipmentWeather(ctx: RequestContext, siteId: string): Promise<SiteEquipmentWeatherResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      const { customerIds: ids } = await ownSite(tx, ctx, siteId);
      const mine = await tx.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.projectSiteId, siteId), inArray(rentals.customerId, ids)));
      return latestEquipmentWeather(tx, siteId, mine.map((row) => row.id));
    });
  }

  async createSite(ctx: RequestContext, body: CustomerSiteCreate): Promise<CustomerSiteResponse> {
    assertCustomer(ctx);
    if (!onLuzonMainland(body.latitude, body.longitude)) throw new UnprocessableEntityException({ error: 'outside_luzon_mainland' });
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, body.customerId)))
        throw new NotFoundException({ error: 'company_not_found' });
      const [address] = await tx
        .insert(addresses)
        .values({
          tenantId: ctx.tenantId,
          line1: body.line1,
          barangay: body.barangay || null,
          city: body.city,
          province: body.province,
          postalCode: body.postalCode || null,
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

  async listForReview(ctx: RequestContext, kycStatus: string, limit = 50, offset = 0): Promise<CompanyReviewListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const where = eq(customers.kycStatus, kycStatus);
      const rows = await tx
        .select()
        .from(customers)
        .where(where)
        .orderBy(desc(customers.createdAt), desc(customers.id))
        .limit(limit)
        .offset(offset);
      return { items: await withScores(tx, await withDocuments(tx, rows, true)), total: await countRows(tx, customers, where) };
    });
  }

  // ownsCustomer() on top of RLS (customers share a tenant scope); 404 rather than 403 so ids don't leak.
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

  // Decides nothing: kyc_status is untouched and approval stays the explicit decide() call (RFC-2 human gate).
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

      const typed = (doc.ocrPayload as Record<string, unknown> | null)?.customer_id_type;
      const read = await this.analyzeDocument(ctx, doc.documentType, bytes, false, idTypeOf(typed));
      if (read.extractionAvailable) {
        await tx
          .update(kycDocuments)
          .set({
            // Replaces the OCR's keys, never what a person confirmed.
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

  async reapply(ctx: RequestContext, customerId: string): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId))) throw new NotFoundException({ error: 'company_not_found' });
      const [row] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'company_not_found' });
      if (row.kycStatus !== 'rejected') throw new ConflictException({ error: 'not_rejected' });
      if (isFinalRejection(row)) throw new ConflictException({ error: 'rejection_final' });
      const live = await liveDocuments(tx, customerId);
      const since = row.rejectedAt ?? new Date(0);
      const missing = row.cureDocuments.filter(
        (type) => !live.some((doc) => doc.documentType === type && doc.createdAt > since),
      );
      if (missing.length > 0) throw new ConflictException({ error: 'cure_documents_missing', documentTypes: missing });
      if (!hasRequiredCompanyDocuments(live)) throw new ConflictException({ error: 'documents_incomplete' });

      // The rejection stays on the row so the reviewer sees what this answers.
      await tx.update(customers).set({ kycStatus: 'pending' }).where(eq(customers.id, customerId));
      await tx
        .update(kycDocuments)
        .set({ status: 'needs_review' })
        .where(and(eq(kycDocuments.customerId, customerId), eq(kycDocuments.status, 'rejected')));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'customers',
        entityId: customerId,
        reason: `reapplied after rejection: ${row.rejectionReason ?? 'unknown'}`,
      });
      await notifyStaff(tx, ctx.tenantId, 'company_reapplied', {
        customer_id: customerId,
        company_name: row.companyName,
        previous_reason: row.rejectionReason,
      });
      const [updated] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      return (await withDocuments(tx, [updated!]))[0]!;
    });
  }

  // Human gate: approval needs every registry paper checked plus the identity checks; the reviewer never edits the submission.
  async decide(ctx: RequestContext, customerId: string, body: CompanyDecision) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'company_not_found' });
      if (row.kycStatus !== 'pending') throw new ConflictException({ error: 'already_decided' });

      const docs = await liveDocuments(tx, customerId);
      const registryDocs = docs.filter((d) =>
        (REGISTRY_DOCUMENT_TYPES as readonly string[]).includes(d.documentType),
      );

      if (body.decision === 'approved') {
        if (!body.identity) throw new ConflictException({ error: 'identity_checks_required' });
        if (!hasRequiredCompanyDocuments(docs)) throw new ConflictException({ error: 'documents_incomplete' });
        const checked = new Set(body.registryChecked);
        const unchecked = registryDocs.filter((d) => !checked.has(d.id));
        if (unchecked.length > 0) {
          throw new ConflictException({
            error: 'registry_check_required',
            documentTypes: unchecked.map((d) => d.documentType),
          });
        }
        await tx
          .update(customers)
          .set({
            kycStatus: 'approved',
            rejectionReason: null,
            rejectionNote: null,
            cureDocuments: [],
            rejectedAt: null,
            identityChecks: { ...body.identity, checked_by: ctx.userId, checked_at: new Date().toISOString() },
          })
          .where(eq(customers.id, customerId));
        // The confirmed legal name moves to the user account only once the reviewer has verified the ID.
        const id = docs.find((d) => d.documentType === 'government_id');
        const confirmed = (id?.ocrPayload as Record<string, unknown> | null) ?? {};
        const name = (key: string) => (typeof confirmed[`customer_${key}`] === 'string' ? (confirmed[`customer_${key}`] as string) : undefined);
        if (row.userId && (name('first_name') || name('last_name'))) {
          await tx
            .update(users)
            .set({
              ...(name('first_name') ? { firstName: name('first_name') } : {}),
              ...(name('middle_name') ? { middleName: name('middle_name') } : {}),
              ...(name('last_name') ? { lastName: name('last_name') } : {}),
            })
            .where(eq(users.id, row.userId));
        }
        if (registryDocs.length > 0) {
          await tx
            .update(kycDocuments)
            .set({ registryStatus: 'active' })
            .where(inArray(kycDocuments.id, registryDocs.map((d) => d.id)));
        }
      } else {
        if (!body.reason) throw new ConflictException({ error: 'rejection_reason_required' });
        const reason = body.reason;
        const cureDocuments = cureDocumentsFor(reason, body.cureDocuments);
        if (reason === 'document_unreadable' && cureDocuments.length === 0)
          throw new ConflictException({ error: 'cure_documents_required' });
        await tx
          .update(customers)
          .set({
            kycStatus: 'rejected',
            rejectionReason: reason,
            rejectionNote: body.note ?? null,
            cureDocuments,
            rejectedAt: new Date(),
          })
          .where(eq(customers.id, customerId));
        if (reason === 'sec_not_in_good_standing') {
          const secDocs = registryDocs.filter((d) => d.documentType === 'sec_certificate');
          if (secDocs.length > 0)
            await tx.update(kycDocuments).set({ registryStatus: 'suspended' }).where(inArray(kycDocuments.id, secDocs.map((d) => d.id)));
        }
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
        ...(body.decision === 'rejected' ? { reason: `${body.reason ?? ''}${body.note ? `: ${body.note}` : ''}` } : {}),
      });
      if (row.userId) {
        await tx.insert(notifications).values({
          tenantId: ctx.tenantId,
          userId: row.userId,
          notificationType: body.decision === 'approved' ? 'company_verified' : 'company_rejected',
          payload: {
            customer_id: customerId,
            company_name: row.companyName,
            ...(body.decision === 'rejected' && body.reason ? { reason: body.reason, reason_label: KYC_REJECTION_REASONS[body.reason].label } : {}),
          },
        });
      }
      return { id: customerId, kycStatus: body.decision };
    });
  }
}

function isFinalRejection(row: typeof customers.$inferSelect): boolean {
  return (
    row.kycStatus === 'rejected' &&
    row.rejectionReason !== null &&
    (KYC_REJECTION_REASONS[row.rejectionReason as KycRejectionReason]?.final ?? false)
  );
}

// /me/* is the customer's own workspace; staff act through the review endpoints.
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
    rejection:
      row.rejectionReason && row.rejectedAt && row.rejectionReason in KYC_REJECTION_REASONS
        ? {
            reason: row.rejectionReason as KycRejectionReason,
            note: row.rejectionNote,
            cureDocuments: row.cureDocuments,
            rejectedAt: row.rejectedAt,
            final: KYC_REJECTION_REASONS[row.rejectionReason as KycRejectionReason].final,
          }
        : null,
    firstName: name?.firstName ?? null,
    middleName: name?.middleName ?? null,
    lastName: name?.lastName ?? null,
    createdAt: row.createdAt,
  };
}

// The name follows the login (one login can register several companies).
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
        // Legacy 'resubmit_required' rows read as waiting.
        status: doc.status === 'resubmit_required' ? 'pending' : doc.status,
        createdAt: doc.createdAt,
        ...(withReads ? documentReads(doc) : {}),
      })),
  }));
}

// Duplicate checks run within this tenant only (RLS): same TIN, ID number or mobile.
// One login may apply for many companies with one ID and mobile, so its own companies do not count for those.
async function withScores(tx: Tx, companies: CompanyReviewResponse[]): Promise<CompanyReviewResponse[]> {
  if (companies.length === 0) return companies;
  const [allCompanies, phones, ids] = await Promise.all([
    tx.select({ id: customers.id, tin: customers.tin, userId: customers.userId }).from(customers),
    tx
      .select({ customerId: customerContacts.customerId, value: customerContacts.contactValue })
      .from(customerContacts)
      .where(eq(customerContacts.contactType, 'phone')),
    tx
      .select({ customerId: kycDocuments.customerId, payload: kycDocuments.ocrPayload })
      .from(kycDocuments)
      .where(and(eq(kycDocuments.documentType, 'government_id'), ne(kycDocuments.status, 'superseded'))),
  ]);
  const digits = (s: string) => s.replace(/\D/g, '');
  const holders = (entries: { customerId: string; key: string }[]) => {
    const map = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!e.key) continue;
      const set = map.get(e.key) ?? new Set<string>();
      set.add(e.customerId);
      map.set(e.key, set);
    }
    return map;
  };
  const byTin = holders(allCompanies.map((c) => ({ customerId: c.id, key: c.tin ? digits(c.tin) : '' })));
  const byPhone = holders(phones.map((p) => ({ customerId: p.customerId, key: digits(p.value).slice(-10) })));
  // Keyed by card type and number: a passport and an SSS number sharing digits differ.
  const idKey = (type: unknown, value: unknown) =>
    typeof value === 'string' && digits(value) ? `${idTypeOf(type)}:${value.toUpperCase().replace(/[^A-Z0-9]/g, '')}` : '';
  const pcnOf = (payload: unknown) => {
    const p = (payload as Record<string, unknown> | null) ?? {};
    return idKey(p.customer_id_type, p.customer_id_number ?? p.id_number);
  };
  const byPcn = holders(ids.map((d) => ({ customerId: d.customerId, key: pcnOf(d.payload) })));
  const owner = new Map(allCompanies.map((c) => [c.id, c.userId]));
  const shared = (map: Map<string, Set<string>>, key: string, self: string, sameLogin = false) =>
    !!key &&
    [...(map.get(key) ?? [])].some(
      (other) => other !== self && !(sameLogin && owner.get(self) && owner.get(other) === owner.get(self)),
    );
  const today = manilaDate(new Date());

  return companies.map((company) => {
    const phone = phones.find((p) => p.customerId === company.id)?.value ?? null;
    const idDoc = company.documents.find((d) => d.documentType === 'government_id');
    const pcn = idDoc ? idKey(idDoc.customer.id_type, idDoc.customer.id_number ?? idDoc.ocr.id_number) : '';
    return {
      ...company,
      contactPhone: phone,
      score: scoreRegistration({
        companyName: company.companyName,
        tin: company.tin,
        secNumber: company.secNumber,
        documents: company.documents,
        today,
        duplicates: {
          tin: shared(byTin, company.tin ? digits(company.tin) : '', company.id),
          pcn: shared(byPcn, pcn, company.id, true),
          mobile: shared(byPhone, phone ? digits(phone).slice(-10) : '', company.id, true),
        },
      }),
    };
  });
}

function liveDocuments(tx: Tx, customerId: string) {
  return tx
    .select()
    .from(kycDocuments)
    .where(and(eq(kycDocuments.customerId, customerId), ne(kycDocuments.status, 'superseded')));
}

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
  documents: CustomerSiteResponse['documents'] = [],
): CustomerSiteResponse {
  return {
    id: site.id,
    customerId: site.customerId!,
    documents,
    proofComplete: siteProofComplete(documents),
    line1: address.line1,
    barangay: address.barangay,
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
  };
}
