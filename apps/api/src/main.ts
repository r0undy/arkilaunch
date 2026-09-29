import path from 'node:path';
import { config } from 'dotenv';

// SWC hoists imports above this line, so anything reading env at load (NestFactory, AppModule, @arkilaunch/db)
// is require()d after config() below instead.
config({ path: path.resolve(__dirname, '../../../.env') });

// Telemetry must init before any instrumented module (http, express, @nestjs/*) loads.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { initTelemetry, shutdownTelemetry } = require('./telemetry/instrumentation.js');
initTelemetry();

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('reflect-metadata');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ZodValidationPipe } = require('nestjs-zod');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UuidParamPipe } = require('./common/uuid-param.pipe.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DbErrorFilter } = require('./common/db-error.filter.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./app.module.js');

// One request's DB hiccup must not crash the process for every other request.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (request-level DB error did not crash the process):', reason);
});

async function bootstrap() {
  // rawBody lets the PayMongo webhook verify its HMAC against the exact signed bytes.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // ACA's envoy is the socket peer: trust exactly one hop so req.ip is the real client and throttles work.
  // Never trust a client-settable header like CF-Connecting-IP here.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // Tenant storefronts live on `{slug}.<PLATFORM_DOMAIN>`, so any one-label subdomain is allowed too.
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const platformDomain = process.env.PLATFORM_DOMAIN?.replace(/\./g, '\\.');
  const tenantOrigin = platformDomain ? new RegExp(`^https://[a-z0-9-]+\\.${platformDomain}$`) : null;
  app.enableCors({
    origin: tenantOrigin ? [webOrigin, tenantOrigin] : webOrigin,
    credentials: true,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(new ZodValidationPipe(), new UuidParamPipe());
  app.useGlobalFilters(new DbErrorFilter());
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`ArkiLaunch API listening on :${port}`);

  // Flush telemetry on SIGTERM, or the last batch is dropped on every deploy.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      await app.close().catch(() => {});
      await shutdownTelemetry();
      process.exit(0);
    });
  }
}

bootstrap();
