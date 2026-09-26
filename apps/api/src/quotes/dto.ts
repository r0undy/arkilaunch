import { createZodDto } from 'nestjs-zod';
import { QuoteRequestSchema, QuoteReviseSchema } from '@arkilaunch/shared';

// Zod at the boundary (AGENTS.md "Always"). preview prices a full request;
// revise only takes agreed line prices and a discount (standard-pricing CR).
// approve takes no body (it only transitions status by :id).
export class QuoteRequestDto extends createZodDto(QuoteRequestSchema) {}
export class QuoteReviseDto extends createZodDto(QuoteReviseSchema) {}
