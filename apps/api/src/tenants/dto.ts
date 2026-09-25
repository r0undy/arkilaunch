import { createZodDto } from 'nestjs-zod';
import {
  CompanyStatusUpdateRequestSchema,
  TenantApplicationListQuerySchema,
  TenantRegisterRequestSchema,
  TenantBrandingUpdateRequestSchema,
} from '@arkilaunch/shared';

export class TenantBrandingUpdateDto extends createZodDto(TenantBrandingUpdateRequestSchema) {}
export class TenantRegisterDto extends createZodDto(TenantRegisterRequestSchema) {}
export class TenantApplicationListQueryDto extends createZodDto(TenantApplicationListQuerySchema) {}
export class CompanyStatusUpdateDto extends createZodDto(CompanyStatusUpdateRequestSchema) {}
