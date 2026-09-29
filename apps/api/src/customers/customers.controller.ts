import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { MAX_UPLOAD_BYTES } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { validateUpload } from '../storage/upload-validation.js';
import { StorageService, kycBucket } from '../storage/storage.service.js';
import { CustomersService } from './customers.service.js';
import {
  CompanyCreateDto,
  CompanyUpdateDto,
  CompanyDecisionDto,
  CompanyDocumentUploadDto,
  CompanyReviewQueryDto,
  CustomerSiteCreateDto,
  KycScanRequestDto,
  SiteDocumentUploadDto,
} from './dto.js';
import type { CtxRequest, MulterFile } from '../common/request.js';

// Same bucket as staff-side KYC: these are the same class of document.

// Customer prerequisites CR. /me/* is the customer's own companies and
// sites (booking:create is the customer's write permission; the service
// also refuses non-customer roles). /customers/* is the staff review queue.
@Controller()
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly storage: StorageService,
  ) {}

  @Get('me/companies')
  @RequirePermission('booking:read')
  listCompanies(@Req() req: CtxRequest) {
    return this.customers.listCompanies(req.ctx);
  }

  @Post('me/companies')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createCompany(@Body() body: CompanyCreateDto, @Req() req: CtxRequest) {
    return this.customers.createCompany(req.ctx, body);
  }

  @Patch('me/companies/:id')
  @RequirePermission('booking:create')
  updateCompany(@Param('id') id: string, @Body() body: CompanyUpdateDto, @Req() req: CtxRequest) {
    return this.customers.updateCompany(req.ctx, id, body);
  }

  // Validated (size, magic bytes) before anything reaches storage, same as
  // POST /kyc/extract. The already-uploaded bytes are also screened by OCR
  // (addDocument) so an illegible scan is bounced back to the customer
  // immediately rather than waiting in the staff queue.
  @Post('me/companies/:id/documents')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async addDocument(
    @Param('id') id: string,
    @Body() body: CompanyDocumentUploadDto,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: CtxRequest,
  ) {
    const validated = validateUpload(file);
    const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
    await this.storage.uploadObject(kycBucket(), key, file!.buffer, validated.contentType);
    const { documentType, ...confirmed } = body;
    return this.customers.addDocument(req.ctx, id, documentType, key, file!.buffer, confirmed);
  }

  // Scan-first company onboarding: extraction for the customer's own
  // typing, so no kyc:extract permission and a tighter rate limit than the
  // staff endpoint (each call is an Azure DI page spend, QAD-T31). The
  // document itself is still uploaded separately through addDocument.
  @Post('me/kyc/scan')
  @RequirePermission('booking:create')
  // One onboarding scans up to three papers (ID, primary, DTI), so 8 leaves
  // room for one retake each.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async scanDocument(
    @Body() body: KycScanRequestDto,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: CtxRequest,
  ) {
    validateUpload(file);
    return this.customers.scanDocument(req.ctx, body.documentType, file!.buffer, body.idType);
  }

  @Get('me/sites')
  @RequirePermission('booking:read')
  listSites(@Req() req: CtxRequest) {
    return this.customers.listSites(req.ctx);
  }

  @Post('me/sites')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createSite(@Body() body: CustomerSiteCreateDto, @Req() req: CtxRequest) {
    return this.customers.createSite(req.ctx, body);
  }

  // Proof a site is real and theirs: a site photo plus a permit, NTP,
  // title/lease or barangay clearance. Same validation and bucket as KYC.
  @Post('me/sites/:id/documents')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async addSiteDocument(
    @Param('id') id: string,
    @Body() body: SiteDocumentUploadDto,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: CtxRequest,
  ) {
    const validated = validateUpload(file);
    const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
    await this.storage.uploadObject(kycBucket(), key, file!.buffer, validated.contentType);
    return this.customers.addSiteDocument(req.ctx, id, body.documentType, key);
  }

  // Staff open a booking's or truck trip's site proof before confirming it.
  @Get('sites/:id/documents')
  @RequirePermission('quote:approve')
  listSiteDocuments(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.customers.listSiteDocuments(req.ctx, id);
  }

  @Get('sites/:id/documents/:documentId/url')
  @RequirePermission('quote:approve')
  async siteDocumentUrl(@Param('id') id: string, @Param('documentId') documentId: string, @Req() req: CtxRequest) {
    const key = await this.customers.siteDocumentKey(req.ctx, id, documentId);
    return { url: await this.storage.createSignedDownloadUrl(kycBucket(), key) };
  }

  // The customer's own thumbnail for the company card (Figma 251:1945).
  // Same 300s signed URL as the staff route, but gated on booking:read and
  // on owning the company -- see ownDocumentKey().
  @Get('me/companies/:id/documents/:documentId/url')
  @RequirePermission('booking:read')
  async ownDocumentUrl(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: CtxRequest,
  ) {
    const key = await this.customers.ownDocumentKey(req.ctx, id, documentId);
    return { url: await this.storage.createSignedDownloadUrl(kycBucket(), key) };
  }

  // The browse page's weather rail. The two routes on sites.controller.ts
  // are STAFF_READ, so a customer could not read weather at all; this is the
  // customer's own surface, bounded by ownCustomers() in the service.
  //
  // booking:read, not a new weather:read code: that would be granted to the
  // same role set, need seeding in two places, and add nothing -- the
  // isolation here is the ownership check, not the permission. Throttled
  // because each miss is an upstream call against a metered free tier.
  // General forecast when the customer has no site of their own yet.
  @Get('me/forecast')
  @RequirePermission('booking:read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  areaForecast(@Req() req: CtxRequest) {
    return this.customers.areaForecast(req.ctx);
  }

  @Get('me/sites/:id/forecast')
  @RequirePermission('booking:read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  forecast(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.customers.siteForecast(req.ctx, id);
  }

  // Each of the caller's machines on their site, with its weather level.
  @Get('me/sites/:id/equipment-weather')
  @RequirePermission('booking:read')
  equipmentWeather(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.customers.siteEquipmentWeather(req.ctx, id);
  }

    @Get('customers/review')
  @RequirePermission('quote:approve')
  listForReview(@Query() query: CompanyReviewQueryDto, @Req() req: CtxRequest) {
    return this.customers.listForReview(req.ctx, query.kycStatus, query.limit, query.offset);
  }

  // A 300s signed URL; the key is re-read from the row under RLS, never
  // taken from the client.
  @Get('customers/:id/documents/:documentId/url')
  @RequirePermission('quote:approve')
  async documentUrl(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: CtxRequest,
  ) {
    const key = await this.customers.documentKey(req.ctx, id, documentId);
    return { url: await this.storage.createSignedDownloadUrl(kycBucket(), key) };
  }

  // A reviewer's "Read document" click on a company already in the queue,
  // for re-running OCR without asking the customer to reupload. The upload
  // itself already ran this once (addDocument); this is staff-gated and
  // rate-limited because each call is a separate Azure DI page spend
  // (QAD-T31).
  @Post('customers/:id/documents/:documentId/read')
  @RequirePermission('quote:approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async readDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: CtxRequest,
  ) {
    const key = await this.customers.documentKey(req.ctx, id, documentId);
    const url = await this.storage.createSignedDownloadUrl(kycBucket(), key);
    const res = await fetch(url);
    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: 'document_download_failed',
        status: res.status,
      });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return this.customers.readDocument(req.ctx, id, documentId, bytes);
  }

  // After a rejection: the cure papers are uploaded, back to the queue.
  @Post('me/companies/:id/reapply')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  reapply(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.customers.reapply(req.ctx, id);
  }

  // Approve or reject; the reviewer never edits what the customer sent.
  @Patch('customers/:id/kyc')
  @RequirePermission('quote:approve')
  decide(@Param('id') id: string, @Body() body: CompanyDecisionDto, @Req() req: CtxRequest) {
    return this.customers.decide(req.ctx, id, body);
  }
}
