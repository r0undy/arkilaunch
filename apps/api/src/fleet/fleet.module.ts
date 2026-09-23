import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { FleetController } from './fleet.controller.js';
import { FleetService } from './fleet.service.js';

@Module({
  imports: [StorageModule],
  controllers: [FleetController],
  providers: [FleetService, EventsService],
})
export class FleetModule {}
