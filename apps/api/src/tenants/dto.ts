import { createZodDto } from 'nestjs-zod';
import {
  CompanyStatusUpdateRequestSchema,
  TenantApplicationListQuerySchema,
  TenantRegisterRequestSchema,
  TenantBrandingUpdateRequestSchema,
  PaymongoAccountUpdateSchema,
} from '@arkilaunch/shared';

export class TenantBrandingUpdateDto extends createZodDto(TenantBrandingUpdateRequestSchema) {}
export class TenantRegisterDto extends createZodDto(TenantRegisterRequestSchema) {}
export class TenantApplicationListQueryDto extends createZodDto(TenantApplicationListQuerySchema) {}
export class PaymongoAccountUpdateDto extends createZodDto(PaymongoAccountUpdateSchema) {}
export class CompanyStatusUpdateDto extends createZodDto(CompanyStatusUpdateRequestSchema) {}
