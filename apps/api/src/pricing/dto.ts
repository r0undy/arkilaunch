import { createZodDto } from 'nestjs-zod';
import { DieselPriceEntrySchema, PricingParametersInputSchema } from '@arkilaunch/shared';

export class DieselPriceEntryDto extends createZodDto(DieselPriceEntrySchema) {}
export class PricingParametersInputDto extends createZodDto(PricingParametersInputSchema) {}
