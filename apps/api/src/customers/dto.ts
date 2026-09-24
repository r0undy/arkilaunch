import { createZodDto } from 'nestjs-zod';
import {
  CompanyCreateSchema,
  CompanyDecisionSchema,
  CompanyDocumentUploadSchema,
  CompanyReviewCommentSchema,
  CompanyReviewQuerySchema,
  CompanyUpdateSchema,
  CustomerSignupSchema,
  CustomerSiteCreateSchema,
  KycScanRequestSchema,
} from '@arkilaunch/shared';

export class CompanyUpdateDto extends createZodDto(CompanyUpdateSchema) {}
export class CompanyCreateDto extends createZodDto(CompanyCreateSchema) {}
export class CompanyDocumentUploadDto extends createZodDto(CompanyDocumentUploadSchema) {}
export class CustomerSiteCreateDto extends createZodDto(CustomerSiteCreateSchema) {}
export class CompanyReviewQueryDto extends createZodDto(CompanyReviewQuerySchema) {}
export class CompanyDecisionDto extends createZodDto(CompanyDecisionSchema) {}
export class CustomerSignupDto extends createZodDto(CustomerSignupSchema) {}
export class KycScanRequestDto extends createZodDto(KycScanRequestSchema) {}
export class CompanyReviewCommentDto extends createZodDto(CompanyReviewCommentSchema) {}
