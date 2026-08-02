import { createZodDto } from 'nestjs-zod';
import {
  EdtrApproveRequestSchema,
  EdtrCaptureRequestSchema,
  EdtrListQuerySchema,
  EdtrRejectRequestSchema,
} from '@arkilaunch/shared';

export class EdtrCaptureDto extends createZodDto(EdtrCaptureRequestSchema) {}
export class EdtrApproveDto extends createZodDto(EdtrApproveRequestSchema) {}
export class EdtrListQueryDto extends createZodDto(EdtrListQuerySchema) {}
export class EdtrRejectDto extends createZodDto(EdtrRejectRequestSchema) {}
