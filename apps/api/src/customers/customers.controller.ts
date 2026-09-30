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

// /me/* is the customer's own companies and sites (the service also refuses non-customer roles).
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

  // Validated (size, magic bytes) before anything reaches storage.
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

  // Extraction for the customer's own typing: no kyc:extract permission, tighter rate limit (each call is an Azure spend).
  @Post('me/kyc/scan')
  @RequirePermission('booking:create')
  // Up to three papers per onboarding, so 8 leaves room for one retake each.
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

  // Gated on booking:read AND owning the company (ownDocumentKey()).
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

  // The isolation is the ownership check in the service, not the permission.
  // Throttled because each cache miss is an upstream call against a metered free tier.
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

  // The key is re-read from the row under RLS, never taken from the client.
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

  // Staff-gated and rate-limited: each re-read is a separate Azure DI page spend.
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

  @Post('me/companies/:id/reapply')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  reapply(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.customers.reapply(req.ctx, id);
  }

  // The reviewer never edits what the customer sent.
  @Patch('customers/:id/kyc')
  @RequirePermission('quote:approve')
  decide(@Param('id') id: string, @Body() body: CompanyDecisionDto, @Req() req: CtxRequest) {
    return this.customers.decide(req.ctx, id, body);
  }
}
