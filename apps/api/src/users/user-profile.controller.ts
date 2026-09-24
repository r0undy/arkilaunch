import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { MAX_UPLOAD_BYTES, validateUpload } from '../storage/upload-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { avatarBucket, UsersService } from './users.service.js';
import { UserPasswordChangeDto, UserSelfUpdateDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };
type MulterFile = { buffer: Buffer; size: number; mimetype: string };

// The /users/me family -- deliberately a separate controller from
// UsersController, which class-level gates every route on user:manage.
// Reading and editing your own record is not a privileged action (same
// posture as tenants.controller.ts's me/application), so these have no
// @RequirePermission at all; the global JwtAuthGuard/TenantContextGuard chain
// (any authenticated tenant member) is the only gate. Every write targets
// ctx.userId from the verified JWT, never an id from the request.
@Controller('users')
export class UserProfileController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
  ) {}

  @Get('me')
  me(@Req() req: CtxRequest) {
    return this.usersService.me(req.ctx);
  }

  @Patch('me')
  update(@Body() body: UserSelfUpdateDto, @Req() req: CtxRequest) {
    return this.usersService.updateSelf(req.ctx, body);
  }

  // Key built from the verified tenant, never request input; validateUpload
  // sniffs magic bytes. PDFs pass that check for KYC, so they are refused
  // here explicitly -- a profile picture is an image.
  @Post('me/avatar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async avatar(@UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    const validated = validateUpload(file);
    if (!validated.contentType.startsWith('image/'))
      throw new UnprocessableEntityException({ error: 'avatar_must_be_image' });
    const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
    await this.storage.uploadObject(avatarBucket(), key, file!.buffer, validated.contentType);
    return this.usersService.setAvatar(req.ctx, key);
  }

  @Post('me/password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@Body() body: UserPasswordChangeDto, @Req() req: CtxRequest) {
    return this.usersService.changePassword(req.ctx, body);
  }

  @Post('me/sign-out-everywhere')
  @HttpCode(204)
  signOutEverywhere(@Req() req: CtxRequest) {
    return this.usersService.signOutEverywhere(req.ctx);
  }
}
