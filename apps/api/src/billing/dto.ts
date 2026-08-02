import { createZodDto } from 'nestjs-zod';
import { InvoiceListQuerySchema } from '@arkilaunch/shared';

export class InvoiceListQueryDto extends createZodDto(InvoiceListQuerySchema) {}
