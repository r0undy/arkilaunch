import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';
import { SiteHubService } from './site-hub.service.js';

@Module({
  controllers: [SitesController],
  providers: [SitesService, SiteHubService, EventsService],
})
export class SitesModule {}
