import { createZodDto } from 'nestjs-zod';
import { TenantSettingsUpdateRequestSchema } from '@arkilaunch/shared';

export class TenantSettingsUpdateDto extends createZodDto(TenantSettingsUpdateRequestSchema) {}
