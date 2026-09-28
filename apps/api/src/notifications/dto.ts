import { createZodDto } from 'nestjs-zod';
import {
  NotificationListQuerySchema,
  PushSubscriptionCreateSchema,
  PushSubscriptionDeleteSchema,
  TestEmailRequestSchema,
} from '@arkilaunch/shared';

export class NotificationListQueryDto extends createZodDto(NotificationListQuerySchema) {}
export class TestEmailRequestDto extends createZodDto(TestEmailRequestSchema) {}
export class PushSubscriptionCreateDto extends createZodDto(PushSubscriptionCreateSchema) {}
export class PushSubscriptionDeleteDto extends createZodDto(PushSubscriptionDeleteSchema) {}
