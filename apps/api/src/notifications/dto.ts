import { createZodDto } from 'nestjs-zod';
import { NotificationListQuerySchema } from '@arkilaunch/shared';

export class NotificationListQueryDto extends createZodDto(NotificationListQuerySchema) {}
