import { Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { FixtureDocumentIntelligenceAdapter, type EdtrCaptureRequest, type RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { MAX_UPLOAD_BYTES, validateUpload } from '../storage/upload-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { EdtrService } from './edtr.service.js';
import { EdtrApproveDto, EdtrCaptureDto, EdtrListQueryDto, EdtrRejectDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };
type MulterFile = { buffer: Buffer; size: number; mimetype: string };

const EDTR_BUCKET = () => requireEnv('SUPABASE_STORAGE_BUCKET_EDTR');
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

@Controller('edtr')
export class EdtrController {
  constructor(
    private readonly edtr: EdtrService,
    private readonly storage: StorageService,
  ) {}

  // Dev-only POC trigger: the real edtr-ocr-worker is an ACA Job (a
  // separate scheduled process, RFC-2 §2), not an HTTP-callable service.
  // This lets the demo frontend show a paper_ocr scan moving from
  // "queued" to "reconciled"/"review" without standing up a real cron
  // scheduler. Remove before this ships past a POC.
  @Post('dev/run-worker')
  @RequirePermission('edtr:approve')
  async runWorker() {
    const { runEdtrOcrWorker } = await import('@arkilaunch/jobs');
    // No live Azure DI adapter exists yet (decided for this pass); a fixed
    // fixture with plausible values keeps the POC demo meaningful instead
    // of every scan hard-failing against the always-empty stub adapter.
    // The image content itself is not actually read in this pass.
    await runEdtrOcrWorker(
      new FixtureDocumentIntelligenceAdapter({
        fields: {
          hours_active: { value: '8.0', confidence: 0.95 },
          hours_idle: { value: '1.0', confidence: 0.94 },
        },
      }),
    );
    return { ok: true };
  }

  // QAD-T31 (resource abuse / cost bomb): each capture queues an async
  // Azure DI extraction, so this route gets a tighter cap than the global
  // default. paper_ocr arrives multipart with a `file` field (RFC-2 §6:
  // validated + uploaded to Storage here, BEFORE the blob reaches Storage,
  // not via a direct-to-Storage signed upload); digital_entry has no file
  // and is still plain JSON -- multer's FileInterceptor only activates on a
  // multipart content-type, so a JSON request passes through untouched.
  @Post()
  @RequirePermission('edtr:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async capture(@Body() body: EdtrCaptureDto, @UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    let rawFileUri: string | undefined;
    if (body.source === 'paper_ocr') {
      const validated = validateUpload(file);
      const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
      await this.storage.uploadObject(EDTR_BUCKET(), key, file!.buffer, validated.contentType);
      rawFileUri = key;
    }

    const captureRequest: EdtrCaptureRequest = { ...body, rawFileUri };
    return this.edtr.capture(req.ctx, captureRequest);
  }

  // GET /api/v1/edtr?... (S8 review queue). Same permission as capture:
  // staff and timekeepers both hold edtr:create, and the service itself
  // scopes a timekeeper's results to their assigned sites.
  @Get()
  @RequirePermission('edtr:create')
  list(@Query() query: EdtrListQueryDto, @Req() req: CtxRequest) {
    return this.edtr.list(req.ctx, query);
  }

  @Get(':id')
  @RequirePermission('edtr:create')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.edtr.get(req.ctx, id);
  }

  @Post(':id/approve')
  @RequirePermission('edtr:approve')
  approve(@Param('id') id: string, @Body() body: EdtrApproveDto, @Req() req: CtxRequest) {
    return this.edtr.approve(req.ctx, id, body);
  }

  @Post(':id/reject')
  @RequirePermission('edtr:approve')
  reject(@Param('id') id: string, @Body() body: EdtrRejectDto, @Req() req: CtxRequest) {
    return this.edtr.reject(req.ctx, id, body);
  }
}
