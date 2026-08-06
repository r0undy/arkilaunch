import { createZodDto } from 'nestjs-zod';
import {
  SiteAssignmentSetRequestSchema,
  UserInviteRequestSchema,
  UserListQuerySchema,
  UserRoleChangeRequestSchema,
} from '@arkilaunch/shared';

export class UserListQueryDto extends createZodDto(UserListQuerySchema) {}
export class UserInviteDto extends createZodDto(UserInviteRequestSchema) {}
export class UserRoleChangeDto extends createZodDto(UserRoleChangeRequestSchema) {}
export class SiteAssignmentSetDto extends createZodDto(SiteAssignmentSetRequestSchema) {}
