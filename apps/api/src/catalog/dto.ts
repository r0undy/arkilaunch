import { createZodDto } from 'nestjs-zod';
import { CatalogEquipmentListQuerySchema, CatalogTenantListQuerySchema } from '@arkilaunch/shared';

export class CatalogEquipmentListQueryDto extends createZodDto(CatalogEquipmentListQuerySchema) {}
export class CatalogTenantListQueryDto extends createZodDto(CatalogTenantListQuerySchema) {}
