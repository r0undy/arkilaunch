import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { QuotesModule } from '../quotes/quotes.module.js';

@Module({
  imports: [QuotesModule],
  controllers: [BookingsController],
  providers: [BookingsService, EventsService],
})
export class BookingsModule {}
