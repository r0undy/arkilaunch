import { Module } from '@nestjs/common';
import { QuotesModule } from '../quotes/quotes.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { TrucksController } from './trucks.controller.js';
import { TrucksService } from './trucks.service.js';

@Module({
  imports: [QuotesModule, PaymentsModule],
  controllers: [TrucksController],
  providers: [TrucksService],
})
export class TrucksModule {}
