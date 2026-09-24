import { Module } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { createDocumentIntelligenceAdapter } from '../ports/document-intelligence.port.js';
import { DOCUMENT_INTELLIGENCE_PORT } from '../kyc/kyc.tokens.js';
import { createWeatherAdapter } from '@arkilaunch/weather';
import { WEATHER_FORECAST_PORT } from './weather.tokens.js';

@Module({
  imports: [StorageModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    EventsService,
    { provide: DOCUMENT_INTELLIGENCE_PORT, useFactory: createDocumentIntelligenceAdapter },
    { provide: WEATHER_FORECAST_PORT, useFactory: () => createWeatherAdapter() },
  ],
})
export class CustomersModule {}
