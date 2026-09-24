import { createZodDto } from 'nestjs-zod';
import {
  CompanyCreateSchema,
  CompanyDecisionSchema,
  CompanyDocumentUploadSchema,
  CompanyReviewQuerySchema,
  CompanyUpdateSchema,
  CustomerSignupSchema,
  CustomerSiteCreateSchema,
} from '@arkilaunch/shared';

export class CompanyUpdateDto extends createZodDto(CompanyUpdateSchema) {}
export class CompanyCreateDto extends createZodDto(CompanyCreateSchema) {}
export class CompanyDocumentUploadDto extends createZodDto(CompanyDocumentUploadSchema) {}
export class CustomerSiteCreateDto extends createZodDto(CustomerSiteCreateSchema) {}
export class CompanyReviewQueryDto extends createZodDto(CompanyReviewQuerySchema) {}
export class CompanyDecisionDto extends createZodDto(CompanyDecisionSchema) {}
export class CustomerSignupDto extends createZodDto(CustomerSignupSchema) {}
