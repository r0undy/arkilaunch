import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';
import { PricingEngineService } from './pricing-engine.service.js';

@Module({
  controllers: [QuotesController],
  providers: [QuotesService, PricingEngineService, EventsService],
  exports: [PricingEngineService],
})
export class QuotesModule {}
