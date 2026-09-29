import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

export const testimonials = pgTable(
  'testimonials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    quote: text('quote').notNull(),
    authorName: text('author_name').notNull(),
    authorTitle: text('author_title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [tenantIsolationPolicy(),
    index('testimonials_tenant_id_idx').on(table.tenantId),
  ],
);
