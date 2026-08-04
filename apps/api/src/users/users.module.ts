import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsService } from '../events/events.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, EventsService],
})
export class UsersModule {}
