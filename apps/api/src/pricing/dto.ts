import { createZodDto } from 'nestjs-zod';
import {
  DieselPriceEntrySchema,
  PricingParametersInputSchema,
  PricingParametersQuerySchema,
  RateCardCreateRequestSchema,
  RateCardListQuerySchema,
  RateCardSupersedeRequestSchema,
} from '@arkilaunch/shared';

export class DieselPriceEntryDto extends createZodDto(DieselPriceEntrySchema) {}
export class PricingParametersInputDto extends createZodDto(PricingParametersInputSchema) {}
export class PricingParametersQueryDto extends createZodDto(PricingParametersQuerySchema) {}
export class RateCardCreateDto extends createZodDto(RateCardCreateRequestSchema) {}
export class RateCardSupersedeDto extends createZodDto(RateCardSupersedeRequestSchema) {}
export class RateCardListQueryDto extends createZodDto(RateCardListQuerySchema) {}
