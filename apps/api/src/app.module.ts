import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { TenantContextGuard } from './common/guards/tenant-context.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';

// Guard order matters: identity, then tenant-context derivation, then RBAC
// (AGENTS.md §4). @Public() routes (auth, health) opt out of all three.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, HealthModule, TenantsModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
