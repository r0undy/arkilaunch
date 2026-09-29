import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { MAX_UPLOAD_BYTES, type EdtrCaptureRequest } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { validateUpload } from '../storage/upload-validation.js';
import { StorageService, edtrBucket } from '../storage/storage.service.js';
import { EdtrService } from './edtr.service.js';
import { EdtrApproveDto, EdtrCaptureDto, EdtrListQueryDto, EdtrRejectDto, EdtrReviewDto } from './dto.js';
import type { CtxRequest, MulterFile } from '../common/request.js';

@Controller('edtr')
export class EdtrController {
  constructor(
    private readonly edtr: EdtrService,
    private readonly storage: StorageService,
  ) {}

  // The `POST edtr/dev/run-worker` POC shim was removed here by
  // cr-arkilaunch-pilot-honesty.md. Its own comment said "Remove before
  // this ships past a POC", and it did two things a shipping build must
  // not: it exposed the ACA Job's entrypoint over HTTP (the real
  // edtr-ocr-worker is a separate scheduled process, RFC-2 §2), and it
  // injected a fixture with literal hours_active: '8.0' while never
  // reading the uploaded image at all.
  //
  // Local-dev replacement, matching how production actually runs it
  // (infra/terraform/modules/cron_job): `pnpm --filter @arkilaunch/jobs
  // worker:edtr`. See docs/runbook-local-dev.md.

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
      await this.storage.uploadObject(edtrBucket(), key, file!.buffer, validated.contentType);
      rawFileUri = key;
    }

    const captureRequest: EdtrCaptureRequest = { ...body, rawFileUri };
    return this.edtr.capture(req.ctx, captureRequest);
  }

  // GET /api/v1/edtr?... (S8 review queue). Staff only (edtr:read): the
  // timekeeper submits and nothing else (cr-arkilaunch-edtr-site-hub-approval.md).
  // The service's own timekeeper site-scoping stays as defence in depth.
  @Get()
  @RequirePermission('edtr:read')
  list(@Query() query: EdtrListQueryDto, @Req() req: CtxRequest) {
    return this.edtr.list(req.ctx, query);
  }

  @Get(':id')
  @RequirePermission('edtr:read')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.edtr.get(req.ctx, id);
  }

  // Signed, short-lived URL for the scanned page, so the review screen can
  // draw the OCR bounding boxes over the image the model actually read.
  // Never a public URL (RFC-2 §6); the key is re-derived from the owning
  // row under RLS, never taken from the caller.
  @Get(':id/image')
  @RequirePermission('edtr:read')
  async image(@Param('id') id: string, @Req() req: CtxRequest) {
    const key = await this.edtr.rawFileKey(req.ctx, id);
    const url = await this.storage.createSignedDownloadUrl(edtrBucket(), key);
    return { url, expiresInSeconds: 300 };
  }

  // Addressed by reconciliation id: what a reviewer working the queue
  // actually holds. Three segments, so it never collides with ':id/approve'.
  @Post('reconciliations/:reconciliationId/approve')
  @RequirePermission('edtr:approve')
  approveByReconciliation(
    @Param('reconciliationId') reconciliationId: string,
    @Body() body: EdtrApproveDto,
    @Req() req: CtxRequest,
  ) {
    return this.edtr.approveByReconciliation(req.ctx, reconciliationId, body);
  }

  @Post(':id/approve')
  @RequirePermission('edtr:approve')
  approve(@Param('id') id: string, @Body() body: EdtrApproveDto, @Req() req: CtxRequest) {
    return this.edtr.approve(req.ctx, id, body);
  }

  // Site hub: approve with the confirmed figures, request a correction,
  // or reject (cr-arkilaunch-edtr-site-hub-approval.md).
  @Post(':id/review')
  @RequirePermission('edtr:approve')
  review(@Param('id') id: string, @Body() body: EdtrReviewDto, @Req() req: CtxRequest) {
    return this.edtr.review(req.ctx, id, body);
  }

  @Post(':id/reject')
  @RequirePermission('edtr:approve')
  reject(@Param('id') id: string, @Body() body: EdtrRejectDto, @Req() req: CtxRequest) {
    return this.edtr.reject(req.ctx, id, body);
  }
}
