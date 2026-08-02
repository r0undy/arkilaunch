import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { EdtrController } from './edtr.controller.js';
import { EdtrService } from './edtr.service.js';

@Module({
  controllers: [EdtrController],
  providers: [EdtrService, EventsService],
})
export class EdtrModule {}
