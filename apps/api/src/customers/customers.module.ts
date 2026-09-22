import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [StorageModule],
  controllers: [CustomersController],
  providers: [CustomersService, EventsService],
})
export class CustomersModule {}
