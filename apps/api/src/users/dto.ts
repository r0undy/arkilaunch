import { createZodDto } from 'nestjs-zod';
import {
  SiteAssignmentSetRequestSchema,
  UserInviteRequestSchema,
  UserListQuerySchema,
  UserPasswordChangeSchema,
  UserRoleChangeRequestSchema,
  UserSelfUpdateSchema,
} from '@arkilaunch/shared';

export class UserSelfUpdateDto extends createZodDto(UserSelfUpdateSchema) {}
export class UserPasswordChangeDto extends createZodDto(UserPasswordChangeSchema) {}

export class UserListQueryDto extends createZodDto(UserListQuerySchema) {}
export class UserInviteDto extends createZodDto(UserInviteRequestSchema) {}
export class UserRoleChangeDto extends createZodDto(UserRoleChangeRequestSchema) {}
export class SiteAssignmentSetDto extends createZodDto(SiteAssignmentSetRequestSchema) {}
