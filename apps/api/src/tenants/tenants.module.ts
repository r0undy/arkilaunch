import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
