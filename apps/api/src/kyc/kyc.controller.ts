import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { KycExtractRequest, RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { MAX_UPLOAD_BYTES, validateUpload } from '../storage/upload-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { KycService } from './kyc.service.js';
import { KycConfirmDto, KycExtractDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };
type MulterFile = { buffer: Buffer; size: number; mimetype: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

@Controller('kyc')
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly storage: StorageService,
  ) {}

  // QAD-T31: each extract queues an async Azure DI page spend. Corporate
  // documents arrive multipart with a `file` field (RFC-2 §6: validated +
  // uploaded to Storage here, before the blob reaches Storage).
  @Post('extract')
  @RequirePermission('kyc:extract')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async extract(@Body() body: KycExtractDto, @UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    const validated = validateUpload(file);
    const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
    await this.storage.uploadObject(requireEnv('SUPABASE_STORAGE_BUCKET_KYC'), key, file!.buffer, validated.contentType);

    const extractRequest: KycExtractRequest = { ...body, fileUri: key };
    return this.kyc.extract(req.ctx, extractRequest);
  }

  @Get(':id')
  @RequirePermission('kyc:extract')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.kyc.get(req.ctx, id);
  }

  // Platform-admin-only human portal confirmation (RFC-2 §2 step 6, PRD-F6 US-06).
  @Post(':id/confirm')
  @RequirePermission('kyc:verify')
  confirm(@Param('id') id: string, @Body() body: KycConfirmDto, @Req() req: CtxRequest) {
    return this.kyc.confirm(req.ctx, id, body);
  }
}
