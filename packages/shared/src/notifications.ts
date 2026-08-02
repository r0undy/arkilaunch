import { z } from 'zod';

// GET /api/v1/notifications?... (PRD §5.2 global nav notifications feed;
// cr-arkilaunch-f9-read-surface.md). jobs/src/maintenance-notify.ts is the
// current writer; nothing could read these rows before this pass.
export const NotificationListQuerySchema = z.object({
  status: z.enum(['unread', 'read']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;
