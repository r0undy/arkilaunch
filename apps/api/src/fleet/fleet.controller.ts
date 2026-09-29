import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { EQUIPMENT_PHOTO_MAX_BYTES } from '@arkilaunch/shared';
import { RequirePermission, STAFF_READ } from '../common/decorators/require-permission.decorator.js';
import { EQUIPMENT_PHOTO_RULES, validateUpload } from '../storage/upload-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { FleetService } from './fleet.service.js';
import {
  EquipmentCreateDto,
  EquipmentListQueryDto,
  EquipmentUpdateDto,
  MaintenanceLogCreateDto,
  MaintenanceScheduleCreateDto,
  RuntimeCorrectionDto,
  UtilizationQueryDto,
  MaintenanceWindowCreateDto,
  MaintenanceWindowExtendDto,
  AvailabilityQueryDto,
  TenantCalendarDto,
} from './dto.js';
import type { CtxRequest, MulterFile } from '../common/request.js';

// Deliberately not the KYC bucket: that one holds RA 10173 personal data
// under its own retention posture. See fleet.service.ts publicPhotoUrl.
const equipmentBucket = () =>
  process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';

// PRD-F4 (Fleet Inventory, Maintenance & Reporting). Reads are open to any
// authenticated tenant member (RLS is the isolation boundary, matching
// reference/*); writes are fleet:manage-gated (QAD-T19: an owner with no
// data-entry permission is denied).
@Controller()
export class FleetController {
  constructor(
    private readonly fleet: FleetService,
    private readonly storage: StorageService,
  ) {}

  @Get('equipment')
  @RequirePermission(...STAFF_READ)
  list(@Query() query: EquipmentListQueryDto, @Req() req: CtxRequest) {
    return this.fleet.list(req.ctx, query);
  }

  @Post('equipment')
  @RequirePermission('fleet:manage')
  create(@Body() body: EquipmentCreateDto, @Req() req: CtxRequest) {
    return this.fleet.create(req.ctx, body);
  }

  @Patch('equipment/:id')
  @RequirePermission('fleet:manage')
  update(@Param('id') id: string, @Body() body: EquipmentUpdateDto, @Req() req: CtxRequest) {
    return this.fleet.update(req.ctx, id, body);
  }

  // A retire, not a delete -- migration 0026 makes a hard delete impossible.
  // Keeps the DELETE verb because that is what the caller means and what the
  // Figma confirm offers; the response says `retired` so nobody is misled.
  @Delete('equipment/:id')
  @RequirePermission('fleet:manage')
  retire(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.fleet.retire(req.ctx, id);
  }

  // The object key is built from the verified ctx.tenantId and never from
  // request input, so a caller cannot address another tenant's prefix.
  // validateUpload sniffs magic bytes, so a forged Content-Type is rejected.
  // Display images only (no PDF) and a 1MB cap: this bucket is public-read.
  @Post('equipment/:id/photo')
  @RequirePermission('fleet:manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EQUIPMENT_PHOTO_MAX_BYTES } }))
  async setPhoto(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: CtxRequest,
  ) {
    const validated = validateUpload(file, EQUIPMENT_PHOTO_RULES);
    const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
    await this.storage.uploadObject(equipmentBucket(), key, file!.buffer, validated.contentType);
    return this.fleet.setPhoto(req.ctx, id, key);
  }

  @Get('equipment/:id/maintenance')
  @RequirePermission(...STAFF_READ)
  maintenanceDetail(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.fleet.maintenanceDetail(req.ctx, id);
  }

  @Post('equipment/:id/maintenance-logs')
  @RequirePermission('fleet:manage')
  recordMaintenanceLog(@Param('id') id: string, @Body() body: MaintenanceLogCreateDto, @Req() req: CtxRequest) {
    return this.fleet.recordMaintenanceLog(req.ctx, id, body);
  }

  @Post('equipment/:id/maintenance-schedules')
  @RequirePermission('fleet:manage')
  createSchedule(
    @Param('id') id: string,
    @Body() body: MaintenanceScheduleCreateDto,
    @Req() req: CtxRequest,
  ) {
    return this.fleet.createSchedule(req.ctx, id, body);
  }

  @Post('equipment/:id/maintenance-windows')
  @RequirePermission('fleet:manage')
  createMaintenanceWindow(@Param('id') id: string, @Body() body: MaintenanceWindowCreateDto, @Req() req: CtxRequest) {
    return this.fleet.createMaintenanceWindow(req.ctx, id, body);
  }

  // Remove a schedule (a duplicate, or to start a fresh plan).
  @Delete('equipment/:id/maintenance-schedules/:scheduleId')
  @RequirePermission('fleet:manage')
  deleteSchedule(@Param('id') id: string, @Param('scheduleId') scheduleId: string, @Req() req: CtxRequest) {
    return this.fleet.deleteSchedule(req.ctx, id, scheduleId);
  }

  @Patch('equipment/:id/maintenance-windows/:windowId')
  @RequirePermission('fleet:manage')
  extendMaintenanceWindow(
    @Param('id') id: string,
    @Param('windowId') windowId: string,
    @Body() body: MaintenanceWindowExtendDto,
    @Req() req: CtxRequest,
  ) {
    return this.fleet.extendMaintenanceWindow(req.ctx, id, windowId, body);
  }

  // Blocks ending within two days, for the admin's extend-or-release cue.
  @Get('equipment/maintenance-windows/ending-soon')
  @RequirePermission(...STAFF_READ)
  windowsEndingSoon(@Req() req: CtxRequest) {
    return this.fleet.windowsEndingSoon(req.ctx);
  }

  @Get('equipment/:id/report')
  @RequirePermission('report:read')
  report(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.fleet.report(req.ctx, id);
  }

  @Delete('equipment/:id/maintenance-windows/:windowId')
  @RequirePermission('fleet:manage')
  deleteMaintenanceWindow(@Param('id') id: string, @Param('windowId') windowId: string, @Req() req: CtxRequest) {
    return this.fleet.deleteMaintenanceWindow(req.ctx, id, windowId);
  }

  // Customers read it too (the booking pickers); only free/taken per day
  // and the business hours go out, never whose booking holds a day.
  @Get('equipment/:id/availability')
  @RequirePermission('booking:read', ...STAFF_READ)
  availability(@Param('id') id: string, @Query() query: AvailabilityQueryDto, @Req() req: CtxRequest) {
    return this.fleet.availability(req.ctx, id, query);
  }

  @Get('tenant-calendar')
  @RequirePermission(...STAFF_READ)
  calendar(@Req() req: CtxRequest) {
    return this.fleet.getCalendar(req.ctx);
  }

  @Put('tenant-calendar')
  @RequirePermission('fleet:manage')
  saveCalendar(@Body() body: TenantCalendarDto, @Req() req: CtxRequest) {
    return this.fleet.saveCalendar(req.ctx, body);
  }

  @Patch('equipment/:id/runtime')
  @RequirePermission('fleet:manage')
  correctRuntime(@Param('id') id: string, @Body() body: RuntimeCorrectionDto, @Req() req: CtxRequest) {
    return this.fleet.correctRuntime(req.ctx, id, body);
  }

  @Get('reports/utilization')
  @RequirePermission('report:read')
  utilizationReport(@Query() query: UtilizationQueryDto, @Req() req: CtxRequest) {
    return this.fleet.utilizationReport(req.ctx, query);
  }

  @Get('reports/financial')
  @RequirePermission('report:read')
  financialReport(@Query() query: UtilizationQueryDto, @Req() req: CtxRequest) {
    return this.fleet.financialReport(req.ctx, query);
  }
}
