import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller.js';
import { RateCardsController } from './rate-cards.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  controllers: [PricingController, RateCardsController],
  providers: [PricingService],
})
export class PricingModule {}
