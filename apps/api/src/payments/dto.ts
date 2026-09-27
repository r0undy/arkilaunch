import { createZodDto } from 'nestjs-zod';
import {
  CheckoutRequestSchema,
  CouponCreateSchema,
  CouponPreviewRequestSchema,
  CouponUpdateSchema,
  InvoiceAmountUpdateSchema,
  PaginationQuerySchema,
  RefundRequestSchema,
} from '@arkilaunch/shared';

export class CheckoutRequestDto extends createZodDto(CheckoutRequestSchema) {}
export class RefundRequestDto extends createZodDto(RefundRequestSchema) {}
export class CouponCreateDto extends createZodDto(CouponCreateSchema) {}
export class CouponUpdateDto extends createZodDto(CouponUpdateSchema) {}
export class CouponPreviewRequestDto extends createZodDto(CouponPreviewRequestSchema) {}
export class CouponListQueryDto extends createZodDto(PaginationQuerySchema) {}
export class InvoiceAmountUpdateDto extends createZodDto(InvoiceAmountUpdateSchema) {}
