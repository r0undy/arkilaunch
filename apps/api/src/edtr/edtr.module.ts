import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { EdtrController } from './edtr.controller.js';
import { EdtrService } from './edtr.service.js';
import { FieldSheetsController } from './field-sheets.controller.js';
import { FieldSheetsService } from './field-sheets.service.js';

@Module({
  imports: [StorageModule],
  controllers: [EdtrController, FieldSheetsController],
  providers: [EdtrService, FieldSheetsService, EventsService],
})
export class EdtrModule {}
