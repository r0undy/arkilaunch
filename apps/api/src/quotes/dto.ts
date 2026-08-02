import { createZodDto } from 'nestjs-zod';
import { QuoteRequestSchema } from '@arkilaunch/shared';

// Zod at the boundary (AGENTS.md "Always"). preview/create/revise share one
// request shape (RFC-3 §3: "/revise ... same body as create... re-prices").
// approve takes no body (it only transitions status by :id).
export class QuoteRequestDto extends createZodDto(QuoteRequestSchema) {}
