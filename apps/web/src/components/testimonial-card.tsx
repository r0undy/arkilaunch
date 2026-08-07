import type { CatalogTestimonial } from '@arkilaunch/shared';

export interface TestimonialCardProps {
  testimonial: CatalogTestimonial;
}

// Card conventions match feature-tile.tsx (rounded-mk-lg surface-mk card,
// shadow-mk-card); this is the anchor tenant's own quote, fetched via
// GET /catalog/testimonials -- see queries.ts catalogQueries.testimonials.
export function TestimonialCard({ testimonial }: TestimonialCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-mk-lg bg-surface-mk p-6 shadow-mk-card">
      <p className="text-lg text-text">&ldquo;{testimonial.quote}&rdquo;</p>
      <div>
        <p className="text-sm font-semibold text-ink-mk">{testimonial.authorName}</p>
        <p className="text-sm text-text-muted">{testimonial.authorTitle}</p>
      </div>
    </div>
  );
}
