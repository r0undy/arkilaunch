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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { MAX_UPLOAD_BYTES, validateUpload } from '../storage/upload-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { CustomersService } from './customers.service.js';
import {
  CompanyCreateDto,
  CompanyDecisionDto,
  CompanyDocumentUploadDto,
  CompanyReviewQueryDto,
  CustomerSiteCreateDto,
} from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };
type MulterFile = { buffer: Buffer; size: number; mimetype: string };

// Same bucket as staff-side KYC: these are the same class of document.
const kycBucket = () => process.env.SUPABASE_STORAGE_BUCKET_KYC ?? 'kyc-documents';

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

  // Validated (size, magic bytes) before anything reaches storage, same as
  // POST /kyc/extract.
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
    return this.customers.addDocument(req.ctx, id, body.documentType, key);
  }

  // Scan-first company onboarding: extraction for the customer's own
  // typing, so no kyc:extract permission and a tighter rate limit than the
  // staff endpoint (each call is an Azure DI page spend, QAD-T31). The
  // document itself is still uploaded separately through addDocument.
  @Post('me/kyc/scan')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async scanDocument(@UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    validateUpload(file);
    return this.customers.scanDocument(req.ctx, file!.buffer);
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

  @Get('customers/review')
  @RequirePermission('quote:approve')
  listForReview(@Query() query: CompanyReviewQueryDto, @Req() req: CtxRequest) {
    return this.customers.listForReview(req.ctx, query.kycStatus);
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

  @Patch('customers/:id/kyc')
  @RequirePermission('quote:approve')
  decide(@Param('id') id: string, @Body() body: CompanyDecisionDto, @Req() req: CtxRequest) {
    return this.customers.decide(req.ctx, id, body);
  }
}
