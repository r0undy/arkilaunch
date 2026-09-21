import { createZodDto } from 'nestjs-zod';
import { CheckoutRequestSchema } from '@arkilaunch/shared';

export class CheckoutRequestDto extends createZodDto(CheckoutRequestSchema) {}
