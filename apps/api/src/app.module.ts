import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { EdtrModule } from './edtr/edtr.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { ReferenceModule } from './reference/reference.module.js';
import { FleetModule } from './fleet/fleet.module.js';
import { SitesModule } from './sites/sites.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { TenantContextGuard } from './common/guards/tenant-context.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';

// Guard order matters: identity, then tenant-context derivation, then RBAC
// (AGENTS.md §4). @Public() routes (auth, health) opt out of all three.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    HealthModule,
    TenantsModule,
    QuotesModule,
    PricingModule,
    EdtrModule,
    KycModule,
    ReferenceModule,
    FleetModule,
    SitesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
