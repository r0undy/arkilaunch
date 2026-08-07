import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants } from './tenancy.js';

// One quote per tenant, surfaced on the public storefront (@Public
// GET /catalog/testimonials) via the same anchor-tenant-slug, SECURITY
// DEFINER pattern as catalog_list_equipment -- see migrations
// 0013_testimonials_table.sql / 0014_public_catalog_testimonials.sql.
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
  () => [tenantIsolationPolicy()],
);
