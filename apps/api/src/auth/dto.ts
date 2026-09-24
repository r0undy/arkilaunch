import { createZodDto } from 'nestjs-zod';
import {
  Enroll2faConfirmRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  UserActivateRequestSchema,
  Verify2faRequestSchema,
} from '@arkilaunch/shared';

// Zod at the boundary (AGENTS.md "Always"): the controller parses these,
// it never trusts a raw request body.
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
export class Verify2faDto extends createZodDto(Verify2faRequestSchema) {}
export class Enroll2faConfirmDto extends createZodDto(Enroll2faConfirmRequestSchema) {}
export class UserActivateDto extends createZodDto(UserActivateRequestSchema) {}
export class ForgotPasswordDto extends createZodDto(ForgotPasswordRequestSchema) {}
