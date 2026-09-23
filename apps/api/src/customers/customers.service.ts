import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
  ExtractionUnavailableError,
  SEC_REGEX,
  TIN_REGEX,
  type CompanyDocumentReadResponse,
  type DocumentIntelligencePort,
  type KycScanResponse,
} from '@arkilaunch/shared';
import { KYC_MODEL_ID, NATIONAL_ID_MODEL_ID } from '@arkilaunch/document-intelligence';
import { createWeatherAdapter } from '@arkilaunch/weather';
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

@Injectable()
export class CustomersService {
  constructor(
    private readonly events: EventsService,
    @Inject(DOCUMENT_INTELLIGENCE_PORT) private readonly port: DocumentIntelligencePort,
    // Defaulted rather than injected through a Nest token, matching
    // runWeatherPoll(port = createWeatherAdapter()): the adapter is chosen by
    // env, and a default keeps the spec able to pass a counting stub.
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
  async scanDocument(ctx: RequestContext, bytes: Buffer): Promise<KycScanResponse> {
    assertCustomer(ctx);
    const empty = { companyName: null, tin: null, secNumber: null };
    let result;
    try {
      result = await this.port.analyze(KYC_MODEL_ID, bytes);
    } catch (error) {
      if (!(error instanceof ExtractionUnavailableError)) throw error;
      await this.events.emit(ctx, 'ocr_extraction_unavailable', {
        doc_type: 'kyc_scan',
        reason: error.reason,
      });
      return { suggestions: empty, extractionAvailable: false };
    }
    const valid = (key: string, re: RegExp) => {
      const field = result.fields[key];
      return field && re.test(field.value) ? field.value : null;
    };
    return {
      suggestions: {
        companyName: result.fields.company_name?.value ?? null,
        tin: valid('tin', TIN_REGEX),
        secNumber: valid('sec_number', SEC_REGEX),
      },
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
      await this.events.emit(ctx, 'company_created', { customer_id: row.id });
      await notifyStaff(tx, ctx.tenantId, 'company_submitted', {
        customer_id: row.id,
        company_name: row.companyName,
      });
      return { ...toCompany(row), documents: [] };
    });
  }

  // Which model a document type reads with: the registration cert asks for
  // company facts, the National ID asks for the holder's name. Shared by
  // the upload-time read and the reviewer's manual re-read, so there is
  // exactly one place that decides which model a document type gets.
  private modelIdFor(documentType: string): string {
    return documentType === 'government_id' ? NATIONAL_ID_MODEL_ID : KYC_MODEL_ID;
  }

  // The minimum confidence (matchBand()'s "mismatch" boundary,
  // packages/shared/src/kyc.ts) a document needs to enter the staff queue
  // unread, whichever type it is. Below it, the scan is illegible enough
  // that a human reviewer would bounce it back anyway, so the customer is
  // asked to reupload immediately instead of waiting in the queue.
  private static readonly UPLOAD_CONFIDENCE_GATE = 0.85;

  // One OCR pass, whichever fields its model returns. The company model
  // yields company_name/tin/sec_number, the National ID model yields
  // first_name/middle_name/last_name -- azure-adapter.ts already maps
  // Azure's query fields to these port keys, so this only needs to read
  // whichever of the six keys came back, not branch on documentType itself.
  private async analyzeDocument(
    ctx: RequestContext,
    documentType: string,
    bytes: Buffer,
  ): Promise<CompanyDocumentReadResponse & { ocrPayload: Record<string, unknown> }> {
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
        suggestions: {
          companyName: null,
          tin: null,
          secNumber: null,
          firstName: null,
          middleName: null,
          lastName: null,
        },
        formatValid: { tin: false, secNumber: false },
        confidence: null,
        extractionAvailable: false,
        ocrPayload: {},
      };
    }

    const nameField = result.fields.company_name ?? null;
    const tinField = result.fields.tin ?? null;
    const secField = result.fields.sec_number ?? null;
    const firstField = result.fields.first_name ?? null;
    const middleField = result.fields.middle_name ?? null;
    const lastField = result.fields.last_name ?? null;
    const formatValid = {
      tin: tinField ? TIN_REGEX.test(tinField.value) : false,
      secNumber: secField ? SEC_REGEX.test(secField.value) : false,
    };
    // The lowest confidence of whatever was found: a reviewer (or the
    // upload-time gate) should judge a document by its weakest field, not
    // its strongest.
    const found = [nameField, tinField, secField, firstField, middleField, lastField].filter(
      (f) => f !== null,
    );
    const confidence = found.length > 0 ? Math.min(...found.map((f) => f!.confidence)) : null;

    return {
      documentId: '',
      suggestions: {
        companyName: nameField?.value ?? null,
        tin: tinField?.value ?? null,
        secNumber: secField?.value ?? null,
        firstName: firstField?.value ?? null,
        middleName: middleField?.value ?? null,
        lastName: lastField?.value ?? null,
      },
      formatValid,
      confidence,
      extractionAvailable: true,
      ocrPayload: {
        ...(nameField
          ? { company_name: nameField.value, company_name_confidence: nameField.confidence }
          : {}),
        ...(tinField ? { tin: tinField.value, tin_confidence: tinField.confidence } : {}),
        ...(secField ? { sec_number: secField.value, sec_confidence: secField.confidence } : {}),
        ...(firstField
          ? { first_name: firstField.value, first_name_confidence: firstField.confidence }
          : {}),
        ...(middleField
          ? { middle_name: middleField.value, middle_name_confidence: middleField.confidence }
          : {}),
        ...(lastField
          ? { last_name: lastField.value, last_name_confidence: lastField.confidence }
          : {}),
      },
    };
  }

  // The file is already validated and in storage (controller); this
  // records it against a company the caller owns, then screens it with the
  // same OCR pass a reviewer would later trigger manually. A legible
  // document goes straight to 'needs_review' (staff queue); one the model
  // can't read is bounced back to the customer as 'resubmit_required'
  // rather than sitting in the queue for a human to reject the same way.
  // This decides nothing about identity or company facts -- only
  // legibility; verification stays decide()'s call (RFC-2's human gate).
  async addDocument(
    ctx: RequestContext,
    customerId: string,
    documentType: string,
    fileUri: string,
    bytes: Buffer,
  ) {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId)))
        throw new NotFoundException({ error: 'company_not_found' });
      const [row] = await tx
        .insert(kycDocuments)
        .values({ tenantId: ctx.tenantId, customerId, documentType, fileUri, status: 'pending' })
        .returning();
      if (!row) throw new Error('kyc_documents insert returned no row');

      const read = await this.analyzeDocument(ctx, documentType, bytes);
      let status = row.status;
      if (read.extractionAvailable) {
        const passed =
          read.confidence === null || read.confidence >= CustomersService.UPLOAD_CONFIDENCE_GATE;
        status = passed ? 'needs_review' : 'resubmit_required';
        await tx
          .update(kycDocuments)
          .set({
            ocrPayload: read.ocrPayload,
            formatValid: { tin: read.formatValid.tin, sec_number: read.formatValid.secNumber },
            ...(read.confidence === null ? {} : { confidence: read.confidence.toFixed(4) }),
            status,
          })
          .where(eq(kycDocuments.id, row.id));
        if (!passed) {
          const [customer] = await tx
            .select()
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1);
          if (customer?.userId) {
            await tx.insert(notifications).values({
              tenantId: ctx.tenantId,
              userId: customer.userId,
              notificationType: 'document_resubmit_required',
              payload: { company_id: customerId, document_type: documentType },
            });
          }
        }
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

  async listForReview(ctx: RequestContext, kycStatus: string): Promise<CompanyResponse[]> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(eq(customers.kycStatus, kycStatus))
        .orderBy(desc(customers.createdAt))
        .limit(100);
      return withDocuments(tx, rows);
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
            ocrPayload: read.ocrPayload,
            formatValid: { tin: read.formatValid.tin, sec_number: read.formatValid.secNumber },
            ...(read.confidence === null ? {} : { confidence: read.confidence.toFixed(4) }),
            status: 'needs_review', // never 'verified': that is decide()'s to set
          })
          .where(eq(kycDocuments.id, documentId));
      }

      return { ...read, documentId };
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

      // Approving with corrections writes what the reviewer confirmed
      // against the document, so a verified company carries the registered
      // name and TIN rather than whatever was typed at signup.
      const corrections =
        body.decision === 'approved'
          ? {
              ...(body.companyName ? { companyName: body.companyName } : {}),
              ...(body.tin ? { tin: body.tin } : {}),
            }
          : {};
      await tx
        .update(customers)
        .set({ kycStatus: body.decision, ...corrections })
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
      // The company has no SEC column; the reviewer-confirmed number is
      // evidence on the registration document it was read from.
      if (body.decision === 'approved' && body.secNumber) {
        const [registration] = await tx
          .select()
          .from(kycDocuments)
          .where(
            and(
              eq(kycDocuments.customerId, customerId),
              eq(kycDocuments.documentType, 'company_registration'),
            ),
          )
          .limit(1);
        if (registration) {
          await tx
            .update(kycDocuments)
            .set({
              ocrPayload: {
                ...(registration.ocrPayload as Record<string, unknown> | null),
                confirmed_sec_number: body.secNumber,
                confirmed_by: ctx.userId,
              },
            })
            .where(eq(kycDocuments.id, registration.id));
        }
      }
      await tx
        .update(kycDocuments)
        .set({ status: body.decision === 'approved' ? 'verified' : 'rejected' })
        .where(eq(kycDocuments.customerId, customerId));
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

async function withDocuments(
  tx: Tx,
  rows: (typeof customers.$inferSelect)[],
): Promise<CompanyResponse[]> {
  if (rows.length === 0) return [];
  const [docs, names] = await Promise.all([
    tx
      .select()
      .from(kycDocuments)
      .where(
        inArray(
          kycDocuments.customerId,
          rows.map((row) => row.id),
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
        status: doc.status,
        createdAt: doc.createdAt,
      })),
  }));
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
