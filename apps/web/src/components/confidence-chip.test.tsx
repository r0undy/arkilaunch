import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfidenceChip } from './confidence-chip.js';

describe('ConfidenceChip', () => {
  it('renders the confidence value in mono, tabular figures', () => {
    const html = renderToStaticMarkup(<ConfidenceChip tone="match" confidence={0.87} />);
    expect(html).toContain('0.87');
    expect(html).toContain('font-mono');
    expect(html).toContain('tabular-nums');
  });

  it('is never color-only: a match chip still carries an icon', () => {
    const html = renderToStaticMarkup(<ConfidenceChip tone="match" confidence={0.95} fieldLabel="Hours active" />);
    expect(html).toContain('Hours active');
    expect(html).toContain('<svg');
  });

  it('makes below-gate tones louder, not quieter', () => {
    const match = renderToStaticMarkup(<ConfidenceChip tone="match" confidence={0.95} />);
    const review = renderToStaticMarkup(<ConfidenceChip tone="review" confidence={0.62} />);
    const failed = renderToStaticMarkup(<ConfidenceChip tone="failed" confidence={0} />);

    expect(match).not.toContain('font-semibold');
    expect(review).toContain('font-semibold');
    expect(review).toContain('ring-2');
    expect(failed).toContain('font-semibold');
    expect(failed).toContain('ring-2');
  });

  it('marks below-gate tones with an assertive status role', () => {
    const match = renderToStaticMarkup(<ConfidenceChip tone="match" confidence={0.95} />);
    const review = renderToStaticMarkup(<ConfidenceChip tone="review" confidence={0.5} />);

    expect(match).not.toContain('role="status"');
    expect(review).toContain('role="status"');
  });
});
