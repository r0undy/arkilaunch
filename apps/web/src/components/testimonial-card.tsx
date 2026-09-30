import type { CatalogTestimonial } from '@arkilaunch/shared';

export interface TestimonialCardProps {
  testimonial: CatalogTestimonial;
}

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
