import { createZodDto } from 'nestjs-zod';
import {
  CompanyStatusUpdateRequestSchema,
  TenantApplicationListQuerySchema,
  TenantRegisterRequestSchema,
  TenantSettingsUpdateRequestSchema,
} from '@arkilaunch/shared';

export class TenantSettingsUpdateDto extends createZodDto(TenantSettingsUpdateRequestSchema) {}
export class TenantRegisterDto extends createZodDto(TenantRegisterRequestSchema) {}
export class TenantApplicationListQueryDto extends createZodDto(TenantApplicationListQuerySchema) {}
export class CompanyStatusUpdateDto extends createZodDto(CompanyStatusUpdateRequestSchema) {}
