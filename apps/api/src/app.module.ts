import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PlatformThrottlerGuard } from './common/throttler/platform-throttler.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { UsersModule } from './users/users.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { EdtrModule } from './edtr/edtr.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { ReferenceModule } from './reference/reference.module.js';
import { FleetModule } from './fleet/fleet.module.js';
import { SitesModule } from './sites/sites.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { BillingModule } from './billing/billing.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { TenantContextGuard } from './common/guards/tenant-context.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';

// Guard order matters: throttling first (QAD-T22/T31 abuse gate, applies
// even to @Public routes like /auth/login -- in-process storage, no Redis
// in V1 per BUILD §3), then identity, then tenant-context derivation, then
// RBAC (AGENTS.md §4). @Public() routes (auth, health) opt out of the
// latter three, not the throttle.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // A generous global default (120 req/min); specific expensive/money
    // routes (POST /edtr, /kyc/extract, /quotes, /bookings/:id/checkout)
    // override this 'default' bucket down to a tighter limit per-route via
    // @Throttle (QAD-T31 "resource abuse / cost bomb").
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    HealthModule,
    TenantsModule,
    UsersModule,
    QuotesModule,
    PricingModule,
    EdtrModule,
    KycModule,
    ReferenceModule,
    FleetModule,
    SitesModule,
    BookingsModule,
    PaymentsModule,
    BillingModule,
    NotificationsModule,
    CatalogModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: PlatformThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
