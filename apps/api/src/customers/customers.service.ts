import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Customer prerequisites CR: the companies a customer login owns (Figma
// 582:3946 "Add New Company"), their verification documents, and the
// project sites they deliver to. RLS bounds the tenant; ownCustomers()
// bounds a customer to their own companies.
@Injectable()
export class CustomersService {
  constructor(private readonly events: EventsService) {}

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
      return { ...toCompany(row), documents: [] };
    });
  }

  // The file is already validated and in storage (controller); this only
  // records it against a company the caller owns.
  async addDocument(ctx: RequestContext, customerId: string, documentType: string, fileUri: string) {
    assertCustomer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (!(await ownsCustomer(tx, ctx, customerId))) throw new NotFoundException({ error: 'company_not_found' });
      const [row] = await tx
        .insert(kycDocuments)
        .values({ tenantId: ctx.tenantId, customerId, documentType, fileUri, status: 'pending' })
        .returning();
      if (!row) throw new Error('kyc_documents insert returned no row');
      return { id: row.id, documentType: row.documentType, status: row.status, createdAt: row.createdAt };
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
      if (!(await ownsCustomer(tx, ctx, body.customerId))) throw new NotFoundException({ error: 'company_not_found' });
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId: ctx.tenantId, line1: body.line1, city: body.city, province: body.province })
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

  // Verification is a human decision on the uploaded ID and registration;
  // nothing here reads or trusts OCR.
  async decide(ctx: RequestContext, customerId: string, body: CompanyDecision) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'company_not_found' });
      if (row.kycStatus === body.decision) throw new ConflictException({ error: 'already_decided' });

      await tx.update(customers).set({ kycStatus: body.decision }).where(eq(customers.id, customerId));
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

async function withDocuments(tx: Tx, rows: (typeof customers.$inferSelect)[]): Promise<CompanyResponse[]> {
  if (rows.length === 0) return [];
  const docs = await tx
    .select()
    .from(kycDocuments)
    .where(inArray(kycDocuments.customerId, rows.map((row) => row.id)))
    .orderBy(desc(kycDocuments.createdAt));
  return rows.map((row) => ({
    ...toCompany(row),
    documents: docs
      .filter((doc) => doc.customerId === row.id)
      .map((doc) => ({ id: doc.id, documentType: doc.documentType, status: doc.status, createdAt: doc.createdAt })),
  }));
}

function toSite(site: typeof projectSites.$inferSelect, address: typeof addresses.$inferSelect): CustomerSiteResponse {
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
