import { createZodDto } from 'nestjs-zod';
import {
  EquipmentCreateRequestSchema,
  EquipmentListQuerySchema,
  EquipmentUpdateRequestSchema,
  MaintenanceLogCreateRequestSchema,
  MaintenanceScheduleCreateRequestSchema,
  RuntimeCorrectionRequestSchema,
  MaintenanceWindowCreateRequestSchema,
  MaintenanceWindowExtendRequestSchema,
  AvailabilityQuerySchema,
  TenantCalendarSchema,
  UtilizationQuerySchema,
  LeakageReportQuerySchema,
} from '@arkilaunch/shared';

// Query DTOs are validated too: nestjs-zod checks metadata.metatype, not paramtype.
export class EquipmentListQueryDto extends createZodDto(EquipmentListQuerySchema) {}
export class EquipmentCreateDto extends createZodDto(EquipmentCreateRequestSchema) {}
export class EquipmentUpdateDto extends createZodDto(EquipmentUpdateRequestSchema) {}
export class MaintenanceLogCreateDto extends createZodDto(MaintenanceLogCreateRequestSchema) {}
export class UtilizationQueryDto extends createZodDto(UtilizationQuerySchema) {}
export class LeakageReportQueryDto extends createZodDto(LeakageReportQuerySchema) {}
export class MaintenanceScheduleCreateDto extends createZodDto(MaintenanceScheduleCreateRequestSchema) {}
export class RuntimeCorrectionDto extends createZodDto(RuntimeCorrectionRequestSchema) {}
export class MaintenanceWindowCreateDto extends createZodDto(MaintenanceWindowCreateRequestSchema) {}
export class AvailabilityQueryDto extends createZodDto(AvailabilityQuerySchema) {}
export class TenantCalendarDto extends createZodDto(TenantCalendarSchema) {}
export class MaintenanceWindowExtendDto extends createZodDto(MaintenanceWindowExtendRequestSchema) {}
