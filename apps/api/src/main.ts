import path from 'node:path';
import { config } from 'dotenv';

// Load the repo-root .env before anything else touches process.env. SWC's
// CJS output hoists `import` statements (converted to `require`) to the
// top of the file regardless of source order -- so NestFactory/AppModule
// (and transitively @arkilaunch/db, which reads env vars at module load)
// cannot be plain top-level imports here, or this config() call would run
// too late. require() them explicitly, after config(), instead.
config({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('reflect-metadata');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core');
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
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // apps/web (Vite dev server, a different origin) calls this API directly;
  // without this the browser blocks every request with a CORS error before
  // it even reaches a controller, which looks exactly like "auth doesn't
  // work" from the login form.
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`ArkiLaunch API listening on :${port}`);
}

bootstrap();
