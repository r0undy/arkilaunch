import { createZodDto } from 'nestjs-zod';
import { KycConfirmRequestSchema, KycExtractFieldsSchema } from '@arkilaunch/shared';

export class KycExtractDto extends createZodDto(KycExtractFieldsSchema) {}
export class KycConfirmDto extends createZodDto(KycConfirmRequestSchema) {}
