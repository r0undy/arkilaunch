import { createZodDto } from 'nestjs-zod';
import {
  EquipmentCreateRequestSchema,
  EquipmentListQuerySchema,
  EquipmentUpdateRequestSchema,
  MaintenanceLogCreateRequestSchema,
  UtilizationQuerySchema,
} from '@arkilaunch/shared';

// Zod at the boundary (AGENTS.md "Always"), including query params: the
// global ZodValidationPipe (main.ts) validates any param whose metatype is
// a zod DTO, not only @Body() (nestjs-zod checks metadata.metatype, not
// paramtype).
export class EquipmentListQueryDto extends createZodDto(EquipmentListQuerySchema) {}
export class EquipmentCreateDto extends createZodDto(EquipmentCreateRequestSchema) {}
export class EquipmentUpdateDto extends createZodDto(EquipmentUpdateRequestSchema) {}
export class MaintenanceLogCreateDto extends createZodDto(MaintenanceLogCreateRequestSchema) {}
export class UtilizationQueryDto extends createZodDto(UtilizationQuerySchema) {}
