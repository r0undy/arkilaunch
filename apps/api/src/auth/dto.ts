import { createZodDto } from 'nestjs-zod';
import { LoginRequestSchema, RefreshRequestSchema } from '@arkilaunch/shared';

// Zod at the boundary (AGENTS.md "Always"): the controller parses these,
// it never trusts a raw request body.
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
