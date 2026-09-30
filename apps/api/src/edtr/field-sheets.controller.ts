import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { EdtrSettingsSchema, FieldSheetDownloadRequestSchema } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { FieldSheetsService } from './field-sheets.service.js';
import type { CtxRequest } from '../common/request.js';

class FieldSheetDownloadDto extends createZodDto(FieldSheetDownloadRequestSchema) {}
class EdtrSettingsDto extends createZodDto(EdtrSettingsSchema) {}

@Controller()
export class FieldSheetsController {
  constructor(private readonly sheets: FieldSheetsService) {}

  @Get('field/edtr-sheets')
  @RequirePermission('edtr:create')
  list(@Req() req: CtxRequest) {
    return this.sheets.list(req.ctx);
  }

  @Post('field/edtr-sheets')
  @RequirePermission('edtr:create')
  download(@Body() body: FieldSheetDownloadDto, @Req() req: CtxRequest) {
    return this.sheets.download(req.ctx, body);
  }

  // Any staff member reads the paper size; only an admin or owner changes it.
  @Get('edtr-settings')
  @RequirePermission('edtr:create', 'tenant:manage')
  settings(@Req() req: CtxRequest) {
    return this.sheets.getSettings(req.ctx);
  }

  @Put('edtr-settings')
  @RequirePermission('tenant:manage')
  saveSettings(@Body() body: EdtrSettingsDto, @Req() req: CtxRequest) {
    return this.sheets.saveSettings(req.ctx, body);
  }
}
