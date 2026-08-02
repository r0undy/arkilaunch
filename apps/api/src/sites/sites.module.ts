import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';

@Module({
  controllers: [SitesController],
  providers: [SitesService, EventsService],
})
export class SitesModule {}
