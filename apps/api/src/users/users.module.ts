import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsService } from '../events/events.service.js';
import { UserProfileController } from './user-profile.controller.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  // UserProfileController MUST be registered before UsersController:
  // UsersController has a class-level `@Get(':id')`, and Nest/Express
  // resolve routes in registration order, so GET /users/me would otherwise
  // be swallowed by that param route (id='me') before ever reaching this
  // controller's literal `@Get('me')`.
  controllers: [UserProfileController, UsersController],
  providers: [UsersService, EventsService],
})
export class UsersModule {}
