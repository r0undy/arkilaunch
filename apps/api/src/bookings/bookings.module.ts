import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, EventsService],
})
export class BookingsModule {}
