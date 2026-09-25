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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import type { RequestContext } from '@arkilaunch/shared';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { MAX_UPLOAD_BYTES } from '../storage/upload-validation.js';
import { TenantsService } from './tenants.service.js';
import {
  CompanyStatusUpdateDto,
  TenantApplicationListQueryDto,
  TenantRegisterDto,
  TenantBrandingUpdateDto,
} from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };
type MulterFile = { buffer: Buffer; size: number; mimetype: string };

function imageKind(kind: string): 'logo' | 'hero' {
  if (kind !== 'logo' && kind !== 'hero') throw new BadRequestException({ error: 'invalid_kind' });
  return kind;
}

// Demonstrates the full golden-path chain (AGENTS.md §4): JWT identity,
// tenant-context derivation, RBAC, and an RLS-scoped read/write -- on a
// resource this slice actually owns. JwtAuthGuard / TenantContextGuard /
// PermissionsGuard are applied globally in app.module.ts; this controller
// just declares the permission it needs.
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  @RequirePermission('tenant:manage')
  me(@Req() req: CtxRequest) {
    return this.tenants.me(req.ctx);
  }

  // Branding (migration 0051). Owner/admin edit their own tenant; the tenant
  // is always req.ctx.tenantId from the verified JWT (RFC-1), never input.
  // legal_name/slug are not in the DTO (.strict()), so the name stays locked.
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

  // POST /tenants/register (@Public, unauthenticated write -- tight
  // throttle since there is no credential to rate-limit by).
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  register(@Body() body: TenantRegisterDto) {
    return this.tenants.register(body);
  }

  // GET /tenants/applications (tenant:approve, platform_admin only). No
  // GET ':id' route exists on this controller, so this literal path cannot
  // collide with the ':id/approve' | ':id/reject' POST routes below.
  @Get('applications')
  @RequirePermission('tenant:approve')
  listApplications(@Query() query: TenantApplicationListQueryDto) {
    return this.tenants.listApplications(query);
  }

  // GET /tenants/companies (tenant:approve, platform_admin only): every
  // rental company past review, with headline counts (migration 0049).
  @Get('companies')
  @RequirePermission('tenant:approve')
  listCompanies() {
    return this.tenants.listCompanies();
  }

  // PATCH /tenants/:id/status (tenant:approve): activate or deactivate a
  // company. Deactivated = no sign-in, no session renewal, storefront offline.
  @Patch(':id/status')
  @RequirePermission('tenant:approve')
  setStatus(
    @Param('id', UuidParamPipe) id: string,
    @Body() body: CompanyStatusUpdateDto,
    @Req() req: CtxRequest,
  ) {
    return this.tenants.setCompanyStatus(req.ctx, id, body.status);
  }

  // Platform admin edits any rental company's branding from /admin/companies.
  @Get(':id/branding')
  @RequirePermission('tenant:approve')
  companyBranding(@Param('id', UuidParamPipe) id: string) {
    return this.tenants.getBranding(id);
  }

  @Patch(':id/branding')
  @RequirePermission('tenant:approve')
  updateCompanyBranding(
    @Param('id', UuidParamPipe) id: string,
    @Body() body: TenantBrandingUpdateDto,
    @Req() req: CtxRequest,
  ) {
    return this.tenants.updateBranding(req.ctx, id, body);
  }

  @Post(':id/branding/:kind')
  @RequirePermission('tenant:approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadCompanyImage(
    @Param('id', UuidParamPipe) id: string,
    @Param('kind') kind: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: CtxRequest,
  ) {
    if (!file) throw new BadRequestException({ error: 'file_required' });
    return this.tenants.setBrandingImage(req.ctx, id, imageKind(kind), file);
  }

  @Delete(':id/branding/:kind')
  @RequirePermission('tenant:approve')
  removeCompanyImage(@Param('id', UuidParamPipe) id: string, @Param('kind') kind: string, @Req() req: CtxRequest) {
    return this.tenants.setBrandingImage(req.ctx, id, imageKind(kind), null);
  }

  // GET /tenants/me/application (tenant:manage) -- an owner's own pending
  // application, if any. No platform-console UI exists yet for the list
  // above, but this unblocks account.applications.tsx immediately.
  @Get('me/application')
  @RequirePermission('tenant:manage')
  myApplication(@Req() req: CtxRequest) {
    return this.tenants.myApplication(req.ctx);
  }

  // POST /tenants/:id/approve | /reject (tenant:approve, platform_admin
  // only). No platform-console UI exists yet -- this is an API/curl-level
  // step for now (see the Change Record for this workstream).
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
