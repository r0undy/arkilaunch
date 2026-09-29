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
import { MAX_UPLOAD_BYTES } from '@arkilaunch/shared';
import { validateUpload } from '../storage/upload-validation.js';
import { StorageService, kycBucket } from '../storage/storage.service.js';
import { UsersService } from './users.service.js';
import { UserPasswordChangeDto, UserSelfUpdateDto } from './dto.js';
import type { CtxRequest, MulterFile } from '../common/request.js';

// No @RequirePermission (UsersController gates on user:manage): every write targets ctx.userId from the JWT.
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

  // Key built from the verified tenant, never input. PDFs pass validateUpload for KYC, so refused here explicitly.
  @Post('me/avatar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async avatar(@UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    const validated = validateUpload(file);
    if (!validated.contentType.startsWith('image/'))
      throw new UnprocessableEntityException({ error: 'avatar_must_be_image' });
    const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
    await this.storage.uploadObject(kycBucket(), key, file!.buffer, validated.contentType);
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
