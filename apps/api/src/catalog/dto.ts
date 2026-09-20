import { createZodDto } from 'nestjs-zod';
import { CatalogEquipmentListQuerySchema } from '@arkilaunch/shared';

export class CatalogEquipmentListQueryDto extends createZodDto(CatalogEquipmentListQuerySchema) {}
