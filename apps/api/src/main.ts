import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`ArkiLaunch API listening on :${port}`);
}

bootstrap();
