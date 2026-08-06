import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
