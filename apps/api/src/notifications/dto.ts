import { createZodDto } from 'nestjs-zod';
import { NotificationListQuerySchema, TestEmailRequestSchema } from '@arkilaunch/shared';

export class NotificationListQueryDto extends createZodDto(NotificationListQuerySchema) {}
export class TestEmailRequestDto extends createZodDto(TestEmailRequestSchema) {}
