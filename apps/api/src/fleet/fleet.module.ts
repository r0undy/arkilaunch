import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { FleetController } from './fleet.controller.js';
import { FleetService } from './fleet.service.js';

@Module({
  controllers: [FleetController],
  providers: [FleetService, EventsService],
})
export class FleetModule {}
