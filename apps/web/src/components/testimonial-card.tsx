import type { CatalogTestimonial } from '@arkilaunch/shared';

export interface TestimonialCardProps {
  testimonial: CatalogTestimonial;
}

// Marketing card conventions (rounded-md surface-mk card, transition-shadow hover:shadow-md,
// DSD §4); this is the anchor tenant's own quote, fetched via
// GET /catalog/testimonials -- see queries.ts catalogQueries.testimonials.
export function TestimonialCard({ testimonial }: TestimonialCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-md bg-surface p-6 transition-shadow hover:shadow-md">
      <p className="text-lg text-text">&ldquo;{testimonial.quote}&rdquo;</p>
      <div>
        <p className="text-sm font-semibold text-text">{testimonial.authorName}</p>
        <p className="text-sm text-text-muted">{testimonial.authorTitle}</p>
      </div>
    </div>
  );
}
