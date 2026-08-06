import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { EdtrController } from './edtr.controller.js';
import { EdtrService } from './edtr.service.js';

@Module({
  imports: [StorageModule],
  controllers: [EdtrController],
  providers: [EdtrService, EventsService],
})
export class EdtrModule {}
