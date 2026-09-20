import { z } from 'zod';

// The one paging shape every list endpoint in this API uses: a page of
// rows plus the unpaged total, so a list can say how much there is rather
// than silently truncating at the cap.
//
// It was hand-copied into ten list schemas before this existed, several of
// them carrying a comment saying "same shape as the users/invoices lists"
// while still duplicating the literal. Extend it rather than re-typing it:
//
//   export const ThingListQuerySchema = PaginationQuerySchema.extend({
//     status: ThingStatusSchema.optional(),
//   });
//
// The 100 cap is the boundary control, not a convenience: it is what stops
// a caller asking for an unbounded read.
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
