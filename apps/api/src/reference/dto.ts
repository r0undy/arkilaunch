import { createZodDto } from 'nestjs-zod';
import { ReferenceRateCardQuerySchema } from '@arkilaunch/shared';

export class ReferenceRateCardQueryDto extends createZodDto(ReferenceRateCardQuerySchema) {}
