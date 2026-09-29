import { createHash } from 'node:crypto';
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
import { ownCustomers, ownsCustomer } from '../common/customer-scope.js';
import { EventsService } from '../events/events.service.js';
import { notifyStaff } from '../common/notify-customer.js';
import { siteDocumentsFor, siteProofComplete } from '../common/site-proof.js';
import { latestEquipmentWeather } from '../common/equipment-weather.js';
import { countRows } from '../common/count-rows.js';


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
  // No address: an SEC certificate prints only the SEC's own letterhead
  // address, which a read used to hand back as the company's.
  sec_certificate: ['companyName', 'secNumber', 'registrationDate'],
  bir_cor: ['companyName', 'tin', 'registeredAddress', 'registrationDate'],
  dti_certificate: ['companyName', 'dtiNumber', 'registeredAddress'],
  company_registration: ['companyName', 'tin', 'secNumber', 'registeredAddress', 'registrationDate'],
};

// Format checks per field. A scan suggestion failing its check is dropped;
// a staff read reports it as invalid instead. The ID number is checked in
// its own card's format (QA 15; PhilSys unless the customer said otherwise).
type FieldFormat = { normalize?: (v: string) => string; re: RegExp };
const FIELD_FORMAT: Partial<Record<ReadField, FieldFormat>> = {
  tin: { normalize: normalizeTin, re: TIN_REGEX },
  secNumber: { normalize: normalizeSecNumber, re: SEC_REGEX },
  dtiNumber: { re: DTI_REGEX },
};
function formatOf(field: ReadField, idType: PhIdTypeCode): FieldFormat | undefined {
  return field === 'idNumber' ? PH_ID_TYPES[idType] : FIELD_FORMAT[field];
}

// Long free-text fields read at structurally lower confidence than a
// number or a name, so they do not count toward a document's legibility.
const LEGIBILITY_EXCLUDED = new Set<ReadField>(['address', 'registeredAddress']);

// The customer's "hard to read" hint on a scan also leaves out middle name
// (often blank) and, on a PhilSys card, sex (not printed on its front), so
// the read's low-score guesses at them never flag a perfectly sharp image.
// The staff read above keeps them (its confidence feeds the RFC-2 review
// gate, which this must not loosen).
const scanHintExcluded = (field: ReadField, idType: PhIdTypeCode) =>
  LEGIBILITY_EXCLUDED.has(field) || field === 'middleName' || (field === 'sex' && idType === 'philsys');

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

function normalizeRead(field: ReadField, value: string, idType: PhIdTypeCode): string {
  if (field === 'sex') return normalizeSex(value);
  if (field === 'birthDate') return normalizeDate(value);
  // Printed as 11/25/2013 or "24th day of April, Twenty Twenty Three";
  // anything else is shown to the reviewer as read.
  if (field === 'registrationDate') return parseCertificateDate(value) ?? value.trim();
  if (field === 'companyName' || field === 'registeredAddress') return value.replace(/\s+/g, ' ').trim();
  return formatOf(field, idType)?.normalize?.(value) ?? value.trim();
}

type CertificateLayout = 'sec_coi' | 'bir_2303' | 'unrecognized';

// One read of a document. For an SEC certificate or a BIR 2303 the label
// parser (packages/shared/src/kyc-certificate.ts) is primary and queryFields
// fill only what it did not find; every other paper is queryFields alone.
// `layout` is null when there is no page text to judge the paper by, and
// 'unrecognized' when the text is not the paper it was uploaded as.
function readCertificate(
  documentType: string,
  result: DocumentExtractionResult,
): { fields: DocumentExtractionResult['fields']; layout: CertificateLayout | null } {
  if (!result.text || (documentType !== 'sec_certificate' && documentType !== 'bir_cor')) {
    return { fields: result.fields, layout: null };
  }
  const parsed = parseRegistrationCertificate(documentType, result.text);
  const fallback = { ...result.fields };
  // On a recognised SEC certificate the query's date is not evidence: it
  // read the Revised Corporation Code's effectivity date on real ones.
  if (parsed.layout === 'sec_coi') delete fallback.registration_date;
  return { fields: { ...fallback, ...parsed.fields }, layout: parsed.layout ?? 'unrecognized' };
}

// What the customer typed on the upload, stored as customer_* keys beside
// the OCR's own keys (and decide()'s confirmed_* ones) on ocr_payload.
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

// The onboarding form scans each paper (POST /me/kyc/scan) and then uploads
// the same bytes on submit; reading them twice doubled the wait and the
// Azure spend. A read is kept for the login that asked for it, keyed by the
// file's hash, so the upload reuses what the scan already computed. The
// server made the read; nothing here comes from the client.
// ponytail: per-instance Map; a miss (other instance, restart, expiry) just
// runs OCR again. Move it to Redis if the API ever scales out wide.
const OCR_CACHE_TTL_MS = 30 * 60_000;
const OCR_CACHE_MAX = 200;

@Injectable()
export class CustomersService {
  // Per service instance, so a read is only ever reused from the same port.
  private readonly ocrCache = new Map<string, { at: number; result: Promise<DocumentExtractionResult> }>();

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
      // A dropped value is never shown, so it does not score either.
      const format = formatOf(field, idType);
      if (format && !format.re.test(value)) continue;
      if (!scanHintExcluded(field, idType)) confidences.push(read.confidence);
      // A certificate's registered address suggests the billing address.
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

  // A new company starts unverified: it can request quotes, but checkout
  // waits until staff approve it (payments.service.ts).
  async createCompany(ctx: RequestContext, body: CompanyCreate): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      // One application per company per login. A pending or verified one is
      // already in; a rejected one is cured and reapplied from its own page.
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
  // silently void the check. A submitted company waiting for review is
  // read-only (the reviewer approves or rejects exactly what was sent); a
  // rejected one opens again so the customer can correct it and reapply.
  async updateCompany(ctx: RequestContext, id: string, body: CompanyUpdate): Promise<CompanyResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, id))) throw new NotFoundException({ error: 'company_not_found' });
      const [current] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
      if (!current) throw new NotFoundException({ error: 'company_not_found' });
      if (current.kycStatus === 'approved' && (body.tin !== undefined || body.secNumber !== undefined))
        throw new ConflictException({ error: 'company_verified_fields_locked' });
      const keys = Object.keys(body);
      if (keys.length > 0 && current.kycStatus === 'pending' && hasRequiredCompanyDocuments(await liveDocuments(tx, id)))
        throw new ConflictException({ error: 'company_locked', fields: keys });
      if (keys.length > 0 && isFinalRejection(current)) throw new ConflictException({ error: 'rejection_final' });
      if (keys.length > 0) await tx.update(customers).set(body).where(eq(customers.id, id));
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

  private analyzeCached(ctx: RequestContext, modelId: string, bytes: Buffer): Promise<DocumentExtractionResult> {
    const key = `${ctx.tenantId}:${ctx.userId}:${modelId}:${createHash('sha256').update(bytes).digest('hex')}`;
    const now = Date.now();
    const ocrCache = this.ocrCache;
    const hit = ocrCache.get(key);
    if (hit && now - hit.at < OCR_CACHE_TTL_MS) return hit.result;
    const result = this.port.analyze(modelId, bytes);
    // A failed read is not kept: the next attempt asks Azure again.
    result.catch(() => ocrCache.delete(key));
    ocrCache.set(key, { at: now, result });
    // Oldest first (Map keeps insertion order).
    while (ocrCache.size > OCR_CACHE_MAX) ocrCache.delete(ocrCache.keys().next().value!);
    return result;
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
    // A reviewer's manual re-read asks Azure afresh; the upload reuses the scan.
    cached = true,
    // Which primary ID a government_id is, for its number's format.
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
    // Which paper the text read as, so the reviewer is told when an upload
    // is not the SEC certificate or 2303 it claims to be.
    const ocrPayload: Record<string, unknown> = layout ? { layout } : {};
    const confidences: number[] = [];
    for (const [field, key] of Object.entries(READ_FIELDS) as [ReadField, string][]) {
      const read = fields[key];
      // Only what this paper prints: one model serves all three
      // certificates, and its low-confidence guess at a TIN on an SEC
      // certificate is neither evidence nor a legibility signal.
      if (!read || !(SCAN_FIELDS[documentType]?.includes(field) ?? true)) continue;
      const value = normalizeRead(field, read.value, idType);
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
    // The lowest confidence of whatever was found: a reviewer (or the
    // upload-time gate) should judge a document by its weakest field, not
    // its strongest.
    const confidence = confidences.length > 0 ? Math.min(...confidences) : null;

    return { documentId: '', suggestions, formatValid, confidence, extractionAvailable: true, ocrPayload };
  }

  // The file is already validated and in storage (controller); this
  // records it against a company the caller owns, then reads it with the
  // same OCR pass a reviewer would later trigger manually, and it goes to
  // the staff queue ('needs_review') however well it read. The selfie and
  // cure papers are never sent to OCR. Nothing is bounced back: a reviewer
  // who cannot use a document rejects with a reason. A document type
  // already on file is replaced only while the company is still being
  // assembled or after a (non-final) rejection, as its cure; the old row is
  // kept as 'superseded' evidence. Verification stays decide()'s call.
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
    // The row is recorded first and the OCR read runs after that transaction
    // commits: a slow Azure call must not hold a pooled connection open.
    const row = await withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId)))
        throw new NotFoundException({ error: 'company_not_found' });
      const live = await liveDocuments(tx, customerId);
      const onFile = live.some((d) => d.documentType === documentType);
      const [company] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (company && isFinalRejection(company)) throw new ConflictException({ error: 'rejection_final' });
      // A company still being assembled (not yet submitted) may replace a
      // document, e.g. a fresh ID over the one carried from another company;
      // a rejected one may replace any, curing the rejection. A submitted or
      // verified company's papers are what was reviewed, so they stay.
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

      // The selfie (a face) and the cure papers go to a person only.
      if (!isOcrDocument(documentType)) {
        await tx.update(kycDocuments).set({ status: 'needs_review' }).where(eq(kycDocuments.id, row.id));
        return { ...row, status: 'needs_review' };
      }
      return row;
    });
    if (!isOcrDocument(documentType)) {
      return { id: row.id, documentType: row.documentType, status: row.status, createdAt: row.createdAt };
    }

    // Usually a cache hit: the form scanned these same bytes a moment ago.
    // A read that fails leaves the row 'pending' for the reviewer's re-read.
    const read = await this.analyzeDocument(ctx, documentType, bytes, true, idTypeOf(confirmed.idType));
    let status = row.status;
    if (read.extractionAvailable) {
      status = 'needs_review';
      await withTenantTx(ctx, (tx) =>
        tx
          .update(kycDocuments)
          .set({
            ocrPayload: { ...read.ocrPayload, ...customerPayload },
            formatValid: storedFormat(read.formatValid),
            ...(read.confidence === null ? {} : { confidence: read.confidence.toFixed(4) }),
            status,
          })
          .where(eq(kycDocuments.id, row.id)),
      );
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

  // POST /me/sites/:id/documents. The file is validated and in storage
  // (controller); this records it against a site of a company the caller
  // owns. A person looks at it; it is never sent to OCR.
  async addSiteDocument(ctx: RequestContext, siteId: string, documentType: string, fileUri: string) {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      const ids = (await ownCustomers(tx, ctx)).map((row) => row.id);
      const [site] = ids.length
        ? await tx.select().from(projectSites).where(and(eq(projectSites.id, siteId), inArray(projectSites.customerId, ids))).limit(1)
        : [];
      if (!site) throw new NotFoundException({ error: 'site_not_found' });
      const [row] = await tx
        .insert(siteDocuments)
        .values({ tenantId: ctx.tenantId, projectSiteId: siteId, documentType, fileUri, uploadedBy: ctx.userId })
        .returning();
      if (!row) throw new Error('site_documents insert returned no row');
      const docs = (await siteDocumentsFor(tx, [siteId])).get(siteId) ?? [];
      return { id: row.id, documentType: row.documentType, status: row.status, createdAt: row.createdAt, proofComplete: siteProofComplete(docs) };
    });
  }

  // GET /sites/:id/documents (staff). What a booking's or truck trip's site
  // carries as proof, for staff to open before confirming the job.
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

    return { siteId, ...(await this.forecastAt(Number(site.latitude), Number(site.longitude))) };
  }

  // GET /me/forecast. Metro Manila, where most of the yard's work is, for a
  // customer with no site yet: the same cached, honest-when-unavailable
  // forecast as a site's, labelled as a general one.
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
    return { days, fetchedAt };
  }

  // GET /me/sites/:id/equipment-weather. The weather level of each machine
  // the caller rents on their own site, from the latest poll, with what to
  // do about it. Only their own machines, never a neighbour's.
  async siteEquipmentWeather(ctx: RequestContext, siteId: string): Promise<SiteEquipmentWeatherResponse> {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      const ids = (await ownCustomers(tx, ctx)).map((row) => row.id);
      if (ids.length === 0) throw new NotFoundException({ error: 'site_not_found' });
      const [site] = await tx
        .select({ id: projectSites.id })
        .from(projectSites)
        .where(and(eq(projectSites.id, siteId), inArray(projectSites.customerId, ids)))
        .limit(1);
      if (!site) throw new NotFoundException({ error: 'site_not_found' });
      const mine = await tx.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.projectSiteId, siteId), inArray(rentals.customerId, ids)));
      return latestEquipmentWeather(tx, siteId, mine.map((row) => row.id));
    });
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

  // --- Staff verification queue (kyc:verify).

  // Each document carries its stored reads, so the reviewer sees what the
  // upload-time OCR and the customer said without a click (or an Azure
  // spend); "Re-read" stays for a fresh pass.
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

      const typed = (doc.ocrPayload as Record<string, unknown> | null)?.customer_id_type;
      const read = await this.analyzeDocument(ctx, doc.documentType, bytes, false, idTypeOf(typed));
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

  // POST /me/companies/:id/reapply. After a (non-final) rejection the
  // customer uploads the papers that cure it and sends the company back to
  // the queue for a fresh decision. Refused until every cure paper has been
  // uploaded since the rejection, and the company is complete again.
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

      // The rejection stays on the row so the reviewer sees what this
      // reapplication answers; decide() clears or replaces it.
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

  // PATCH /customers/:id/kyc. Verification is a human decision on exactly
  // what the customer submitted: the reviewer never edits it. Approval
  // needs every registry paper checked on its registry plus the identity
  // checks (PhilSys QR verified on PhilSys Check, selfie matches the ID,
  // holder authorized for the company). A rejection needs a reason, which
  // tells the customer what cures it.
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
        // Every SEC, 2303 and DTI paper is checked on its public registry by
        // a human before approval: a missed tick refuses the approval.
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
        // The legal name the customer confirmed off their National ID lands
        // on their user account, now that the reviewer verified the card on
        // PhilSys Check -- the person's identity, not this company's.
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
        // What the reviewer saw on the registry, recorded against the paper.
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

// A rejection whose reason cannot be cured by reapplying (a tampered or
// fraudulent paper): the company stays rejected.
function isFinalRejection(row: typeof customers.$inferSelect): boolean {
  return (
    row.kycStatus === 'rejected' &&
    row.rejectionReason !== null &&
    (KYC_REJECTION_REASONS[row.rejectionReason as KycRejectionReason]?.final ?? false)
  );
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

// Adds the applicant's mobile and the advisory score to each company under
// review (cr-arkilaunch-registration-scoring.md). Duplicates are the one
// input only the database knows: another company in THIS tenant (RLS) with
// the same TIN, the same PCN on its National ID, or the same mobile.
async function withScores(tx: Tx, companies: CompanyReviewResponse[]): Promise<CompanyReviewResponse[]> {
  if (companies.length === 0) return companies;
  const [allCompanies, phones, ids] = await Promise.all([
    tx.select({ id: customers.id, tin: customers.tin }).from(customers),
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
  // Keyed by card type and number (QA 15): a passport and an SSS number
  // that share digits are not the same ID.
  const idKey = (type: unknown, value: unknown) =>
    typeof value === 'string' && digits(value) ? `${idTypeOf(type)}:${value.toUpperCase().replace(/[^A-Z0-9]/g, '')}` : '';
  const pcnOf = (payload: unknown) => {
    const p = (payload as Record<string, unknown> | null) ?? {};
    return idKey(p.customer_id_type, p.customer_id_number ?? p.id_number);
  };
  const byPcn = holders(ids.map((d) => ({ customerId: d.customerId, key: pcnOf(d.payload) })));
  const shared = (map: Map<string, Set<string>>, key: string, self: string) =>
    !!key && [...(map.get(key) ?? [])].some((other) => other !== self);
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
          pcn: shared(byPcn, pcn, company.id),
          mobile: shared(byPhone, phone ? digits(phone).slice(-10) : '', company.id),
        },
      }),
    };
  });
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
