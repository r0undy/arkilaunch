import { createZodDto } from 'nestjs-zod';
import {
  CheckoutRequestSchema,
  CouponCreateSchema,
  CouponPreviewRequestSchema,
  CouponUpdateSchema,
  RefundRequestSchema,
} from '@arkilaunch/shared';

export class CheckoutRequestDto extends createZodDto(CheckoutRequestSchema) {}
export class RefundRequestDto extends createZodDto(RefundRequestSchema) {}
export class CouponCreateDto extends createZodDto(CouponCreateSchema) {}
export class CouponUpdateDto extends createZodDto(CouponUpdateSchema) {}
export class CouponPreviewRequestDto extends createZodDto(CouponPreviewRequestSchema) {}
