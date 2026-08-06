import { createZodDto } from 'nestjs-zod';
import {
  EdtrApproveRequestSchema,
  EdtrCaptureFieldsSchema,
  EdtrListQuerySchema,
  EdtrRejectRequestSchema,
} from '@arkilaunch/shared';

export class EdtrCaptureDto extends createZodDto(EdtrCaptureFieldsSchema) {}
export class EdtrApproveDto extends createZodDto(EdtrApproveRequestSchema) {}
export class EdtrListQueryDto extends createZodDto(EdtrListQuerySchema) {}
export class EdtrRejectDto extends createZodDto(EdtrRejectRequestSchema) {}
