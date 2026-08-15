import path from 'node:path';
import { config } from 'dotenv';

// Load the repo-root .env before anything else touches process.env. SWC's
// CJS output hoists `import` statements (converted to `require`) to the
// top of the file regardless of source order -- so NestFactory/AppModule
// (and transitively @arkilaunch/db, which reads env vars at module load)
// cannot be plain top-level imports here, or this config() call would run
// too late. require() them explicitly, after config(), instead.
config({ path: path.resolve(__dirname, '../../../.env') });

// Azure Monitor must be initialized before any instrumented module loads
// (http, express, @nestjs/*) -- the same hazard the dotenv call above
// solves. It needs APPLICATIONINSIGHTS_CONNECTION_STRING from env, so it
// comes right after config() and before every other require() below.
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
const { AppModule } = require('./app.module.js');

// A transient pooler-side hiccup on one request's DB connection must not
// take the whole process down for every other in-flight request. NestJS's
// exception filter already turns a thrown query error into a 500; this
// only guards against it also escaping as an unhandled rejection.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (request-level DB error did not crash the process):', reason);
});

async function bootstrap() {
  // rawBody: true exposes req.rawBody (a Buffer) alongside the normally
  // parsed req.body -- needed so the PayMongo webhook can verify the
  // Paymongo-Signature HMAC against the exact bytes PayMongo signed,
  // before any JSON parsing (QAD-T28). Every other route's Zod DTOs still
  // read the normally parsed req.body; only the webhook handler reads
  // req.rawBody.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Behind Cloudflare (BUILD §3), req.socket.remoteAddress is Cloudflare's
  // edge IP, not the client's -- so without this every request shares one
  // throttle bucket (QAD-T22/T31 controls become fiction). This makes
  // Express trust the X-Forwarded-For chain Cloudflare sets; PlatformThrottlerGuard
  // below prefers the more specific CF-Connecting-IP header.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // apps/web (Vite dev server, a different origin) calls this API directly;
  // without this the browser blocks every request with a CORS error before
  // it even reaches a controller, which looks exactly like "auth doesn't
  // work" from the login form.
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  // File uploads (EDTR/KYC) now go through multipart FileInterceptor
  // (apps/api/src/storage/), not a base64 data: URL in the JSON body, so
  // the JSON limit only needs to be large enough for normal request
  // payloads again -- not a scanned photo's base64 encoding.
  app.useBodyParser('json', { limit: '1mb' });
  // Every controller uses createZodDto (AGENTS.md "Always: validate
  // external input at the boundary with Zod"), but that annotation does
  // nothing on its own -- without this global pipe, invalid/malformed
  // request bodies were never actually rejected at the boundary and could
  // reach a raw DB query instead, surfacing as an uncaught 500 rather than
  // a clean 400.
  app.useGlobalPipes(new ZodValidationPipe());
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`ArkiLaunch API listening on :${port}`);

  // ACA sends SIGTERM on revision replacement; without flushing here the
  // exporter's last batch is dropped on every deploy.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      await app.close().catch(() => {});
      await shutdownTelemetry();
      process.exit(0);
    });
  }
}

bootstrap();
