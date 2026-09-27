import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

// GET /api/v1/notifications?... (PRD §5.2 global nav notifications feed;
// cr-arkilaunch-f9-read-surface.md). jobs/src/maintenance-notify.ts is the
// current writer; nothing could read these rows before this pass.
export const NotificationListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['unread', 'read']).optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

// --- Response schemas (egress allowlists). ---

export const NotificationResponseSchema = z.object({
  id: z.string().uuid(),
  notificationType: z.string(),
  payload: z.unknown(),
  status: z.string(),
  createdAt: z.coerce.date(),
});
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationResponseSchema),
  total: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

// POST /notifications/test-email (admin): sends one sample of a money
// email, with this tenant's branding, to any address.
export const TEST_EMAIL_TYPES = [
  'payment_received',
  'payment_failed',
  'payment_refunded',
  'weekly_invoice',
  'payment_paid',
  'payment_amount_mismatch',
] as const;
export const TestEmailRequestSchema = z
  .object({
    to: z.string().trim().email().max(254),
    type: z.enum(TEST_EMAIL_TYPES),
  })
  .strict();
export type TestEmailRequest = z.infer<typeof TestEmailRequestSchema>;
