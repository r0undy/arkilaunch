import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HazardDivider } from './hazard-divider.js';

describe('HazardDivider', () => {
  it('renders as a separator with a non-decorative label', () => {
    const html = renderToStaticMarkup(<HazardDivider />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('Blocked: resolve before proceeding');
  });

  it('accepts a custom label for the specific blocking state', () => {
    const html = renderToStaticMarkup(<HazardDivider label="Reconciliation discrepancy: approval disabled" />);
    expect(html).toContain('Reconciliation discrepancy: approval disabled');
  });

  it('uses the amber/steel primitives, not a theme-flipping text color', () => {
    const html = renderToStaticMarkup(<HazardDivider />);
    expect(html).toContain('var(--color-primary)');
    expect(html).toContain('var(--steel-900)');
    expect(html).not.toContain('var(--color-text)');
  });
});
