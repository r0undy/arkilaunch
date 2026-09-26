import { createZodDto } from 'nestjs-zod';
import { CheckoutRequestSchema, RefundRequestSchema } from '@arkilaunch/shared';

export class CheckoutRequestDto extends createZodDto(CheckoutRequestSchema) {}
export class RefundRequestDto extends createZodDto(RefundRequestSchema) {}
