import { createZodDto } from 'nestjs-zod';
import { TenantRegisterRequestSchema, TenantSettingsUpdateRequestSchema } from '@arkilaunch/shared';

export class TenantSettingsUpdateDto extends createZodDto(TenantSettingsUpdateRequestSchema) {}
export class TenantRegisterDto extends createZodDto(TenantRegisterRequestSchema) {}
