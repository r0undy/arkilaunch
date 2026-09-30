import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { TurnstileGuard } from '../common/turnstile.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { MAX_UPLOAD_BYTES } from '@arkilaunch/shared';
import { TenantsService } from './tenants.service.js';
import {
  CompanyStatusUpdateDto,
  TenantApplicationListQueryDto,
  TenantRegisterDto,
  TenantBrandingUpdateDto,
  PaymongoAccountUpdateDto,
} from './dto.js';
import type { CtxRequest, MulterFile } from '../common/request.js';

function imageKind(kind: string): 'logo' | 'hero' | 'icon' | 'login' {
  if (kind !== 'logo' && kind !== 'hero' && kind !== 'icon' && kind !== 'login') throw new BadRequestException({ error: 'invalid_kind' });
  return kind;
}

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  @RequirePermission('tenant:manage')
  me(@Req() req: CtxRequest) {
    return this.tenants.me(req.ctx);
  }

  // The tenant is always req.ctx.tenantId from the verified JWT, never input; legal_name/slug aren't in the strict DTO.
  @Get('me/branding')
  @RequirePermission('tenant:manage')
  myBranding(@Req() req: CtxRequest) {
    return this.tenants.getBranding(req.ctx.tenantId);
  }

  @Patch('me/branding')
  @RequirePermission('tenant:manage')
  updateMyBranding(@Body() body: TenantBrandingUpdateDto, @Req() req: CtxRequest) {
    return this.tenants.updateBranding(req.ctx, req.ctx.tenantId, body);
  }

  @Post('me/branding/:kind')
  @RequirePermission('tenant:manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadMyImage(@Param('kind') kind: string, @UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    if (!file) throw new BadRequestException({ error: 'file_required' });
    return this.tenants.setBrandingImage(req.ctx, req.ctx.tenantId, imageKind(kind), file);
  }

  @Delete('me/branding/:kind')
  @RequirePermission('tenant:manage')
  removeMyImage(@Param('kind') kind: string, @Req() req: CtxRequest) {
    return this.tenants.setBrandingImage(req.ctx, req.ctx.tenantId, imageKind(kind), null);
  }

  // Unauthenticated write: tight throttle, since there is no credential to rate-limit by.
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @UseGuards(TurnstileGuard)
  register(@Body() body: TenantRegisterDto) {
    return this.tenants.register(body);
  }

  // No GET ':id' route exists here, so this literal path can't collide with ':id/approve' | ':id/reject'.
  @Get('applications')
  @RequirePermission('tenant:approve')
  listApplications(@Query() query: TenantApplicationListQueryDto) {
    return this.tenants.listApplications(query);
  }

  @Get('companies')
  @RequirePermission('tenant:approve')
  listCompanies() {
    return this.tenants.listCompanies();
  }

  // Deactivated = no sign-in, no session renewal, storefront offline.
  @Patch(':id/status')
  @RequirePermission('tenant:approve')
  setStatus(
    @Param('id') id: string,
    @Body() body: CompanyStatusUpdateDto,
    @Req() req: CtxRequest,
  ) {
    return this.tenants.setCompanyStatus(req.ctx, id, body.status);
  }

  @Get(':id/branding')
  @RequirePermission('tenant:approve')
  companyBranding(@Param('id') id: string) {
    return this.tenants.getBranding(id);
  }

  @Patch(':id/branding')
  @RequirePermission('tenant:approve')
  updateCompanyBranding(
    @Param('id') id: string,
    @Body() body: TenantBrandingUpdateDto,
    @Req() req: CtxRequest,
  ) {
    return this.tenants.updateBranding(req.ctx, id, body);
  }

  // Until set, online payments are collected on ArkiLaunch's parent account (TODO(paymongo-child-accounts)).
  @Get(':id/paymongo-account')
  @RequirePermission('tenant:approve')
  companyPaymongoAccount(@Param('id') id: string) {
    return this.tenants.getPaymongoAccount(id);
  }

  @Patch(':id/paymongo-account')
  @RequirePermission('tenant:approve')
  setCompanyPaymongoAccount(
    @Param('id') id: string,
    @Body() body: PaymongoAccountUpdateDto,
    @Req() req: CtxRequest,
  ) {
    return this.tenants.setPaymongoAccount(req.ctx, id, body.accountId);
  }

  @Post(':id/branding/:kind')
  @RequirePermission('tenant:approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadCompanyImage(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: CtxRequest,
  ) {
    if (!file) throw new BadRequestException({ error: 'file_required' });
    return this.tenants.setBrandingImage(req.ctx, id, imageKind(kind), file);
  }

  @Delete(':id/branding/:kind')
  @RequirePermission('tenant:approve')
  removeCompanyImage(@Param('id') id: string, @Param('kind') kind: string, @Req() req: CtxRequest) {
    return this.tenants.setBrandingImage(req.ctx, id, imageKind(kind), null);
  }

  @Get('me/application')
  @RequirePermission('tenant:manage')
  myApplication(@Req() req: CtxRequest) {
    return this.tenants.myApplication(req.ctx);
  }

  @Post(':id/approve')
  @RequirePermission('tenant:approve')
  approve(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.tenants.decideApplication(req.ctx, id, 'approved');
  }

  @Post(':id/reject')
  @RequirePermission('tenant:approve')
  reject(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.tenants.decideApplication(req.ctx, id, 'rejected');
  }
}
