import { createZodDto } from 'nestjs-zod';
import { KycConfirmRequestSchema, KycExtractRequestSchema } from '@arkilaunch/shared';

export class KycExtractDto extends createZodDto(KycExtractRequestSchema) {}
export class KycConfirmDto extends createZodDto(KycConfirmRequestSchema) {}
