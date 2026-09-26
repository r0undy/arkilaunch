import { createZodDto } from 'nestjs-zod';
import {
  DeploymentCreateRequestSchema,
  IncidentListQuerySchema,
  PagasaAdvisoryCreateSchema,
  SiteListQuerySchema,
  SiteCreateRequestSchema,
  SiteUpdateRequestSchema,
} from '@arkilaunch/shared';

export class SiteCreateDto extends createZodDto(SiteCreateRequestSchema) {}
export class SiteUpdateDto extends createZodDto(SiteUpdateRequestSchema) {}
export class DeploymentCreateDto extends createZodDto(DeploymentCreateRequestSchema) {}
export class IncidentListQueryDto extends createZodDto(IncidentListQuerySchema) {}
export class SiteListQueryDto extends createZodDto(SiteListQuerySchema) {}
export class PagasaAdvisoryCreateDto extends createZodDto(PagasaAdvisoryCreateSchema) {}
