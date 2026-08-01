import { createZodDto } from 'nestjs-zod';
import { EdtrApproveRequestSchema, EdtrCaptureRequestSchema } from '@arkilaunch/shared';

export class EdtrCaptureDto extends createZodDto(EdtrCaptureRequestSchema) {}
export class EdtrApproveDto extends createZodDto(EdtrApproveRequestSchema) {}
