import { createZodDto } from 'nestjs-zod';
import { QuoteRequestSchema } from '@arkilaunch/shared';

export class QuoteRequestDto extends createZodDto(QuoteRequestSchema) {}
