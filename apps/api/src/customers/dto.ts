import { createZodDto } from 'nestjs-zod';
import {
  CompanyCreateSchema,
  CompanyDecisionSchema,
  CompanyDocumentUploadSchema,
  CompanyReviewQuerySchema,
  CustomerSignupSchema,
  CustomerSiteCreateSchema,
} from '@arkilaunch/shared';

export class CompanyCreateDto extends createZodDto(CompanyCreateSchema) {}
export class CompanyDocumentUploadDto extends createZodDto(CompanyDocumentUploadSchema) {}
export class CustomerSiteCreateDto extends createZodDto(CustomerSiteCreateSchema) {}
export class CompanyReviewQueryDto extends createZodDto(CompanyReviewQuerySchema) {}
export class CompanyDecisionDto extends createZodDto(CompanyDecisionSchema) {}
export class CustomerSignupDto extends createZodDto(CustomerSignupSchema) {}
