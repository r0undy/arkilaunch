import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  controllers: [PricingController],
  providers: [PricingService],
})
export class PricingModule {}
