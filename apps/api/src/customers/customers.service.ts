import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
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
import { KYC_MODEL_ID } from '@arkilaunch/document-intelligence';
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
@Injectable()
export class CustomersService {
  constructor(
    private readonly events: EventsService,
    @Inject(DOCUMENT_INTELLIGENCE_PORT) private readonly port: DocumentIntelligencePort,
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
          billingAddress: body.billingAddress,
          kycStatus: 'pending',
        })
        .returning();
      if (!row) throw new Error('customers insert returned no row');
      await tx.insert(customerContacts).values({
        tenantId: ctx.tenantId,
        customerId: row.id,
        contactType: 'phone',
        contactValue: `${body.contactName} ${body.contactMobile}`,
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

  // The file is already validated and in storage (controller); this only
  // records it against a company the caller owns.
  async addDocument(
    ctx: RequestContext,
    customerId: string,
    documentType: string,
    fileUri: string,
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
      return {
        id: row.id,
        documentType: row.documentType,
        status: row.status,
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

      let result;
      try {
        result = await this.port.analyze(KYC_MODEL_ID, bytes);
      } catch (error) {
        if (!(error instanceof ExtractionUnavailableError)) throw error;
        await this.events.emit(ctx, 'ocr_extraction_unavailable', {
          doc_type: 'company_document',
          reason: error.reason,
        });
        return {
          documentId,
          suggestions: { companyName: null, tin: null, secNumber: null },
          formatValid: { tin: false, secNumber: false },
          confidence: null,
          extractionAvailable: false,
        };
      }

      const nameField = result.fields.company_name ?? null;
      const tinField = result.fields.tin ?? null;
      const secField = result.fields.sec_number ?? null;
      const formatValid = {
        tin: tinField ? TIN_REGEX.test(tinField.value) : false,
        secNumber: secField ? SEC_REGEX.test(secField.value) : false,
      };
      // The lowest confidence of whatever was found: a reviewer should judge
      // a document by its weakest field, not its strongest.
      const found = [nameField, tinField, secField].filter((f) => f !== null);
      const confidence = found.length > 0 ? Math.min(...found.map((f) => f!.confidence)) : null;

      await tx
        .update(kycDocuments)
        .set({
          ocrPayload: {
            ...(nameField
              ? { company_name: nameField.value, company_name_confidence: nameField.confidence }
              : {}),
            ...(tinField ? { tin: tinField.value, tin_confidence: tinField.confidence } : {}),
            ...(secField
              ? { sec_number: secField.value, sec_confidence: secField.confidence }
              : {}),
          },
          formatValid: { tin: formatValid.tin, sec_number: formatValid.secNumber },
          ...(confidence === null ? {} : { confidence: confidence.toFixed(4) }),
          status: 'needs_review', // never 'verified': that is decide()'s to set
        })
        .where(eq(kycDocuments.id, documentId));

      return {
        documentId,
        suggestions: {
          companyName: nameField?.value ?? null,
          tin: tinField?.value ?? null,
          secNumber: secField?.value ?? null,
        },
        formatValid,
        confidence,
        extractionAvailable: true,
      };
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

function toCompany(row: typeof customers.$inferSelect): Omit<CompanyResponse, 'documents'> {
  return {
    id: row.id,
    companyName: row.companyName,
    tin: row.tin,
    billingAddress: row.billingAddress,
    kycStatus: row.kycStatus,
    createdAt: row.createdAt,
  };
}

async function withDocuments(
  tx: Tx,
  rows: (typeof customers.$inferSelect)[],
): Promise<CompanyResponse[]> {
  if (rows.length === 0) return [];
  const docs = await tx
    .select()
    .from(kycDocuments)
    .where(
      inArray(
        kycDocuments.customerId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(desc(kycDocuments.createdAt));
  return rows.map((row) => ({
    ...toCompany(row),
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
