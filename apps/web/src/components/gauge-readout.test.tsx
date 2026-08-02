import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GaugeReadout } from './gauge-readout.js';

describe('GaugeReadout', () => {
  it('renders the overline label and mono value', () => {
    const html = renderToStaticMarkup(<GaugeReadout label="Diesel price" value="68.40" unit="₱/L" />);
    expect(html).toContain('Diesel price');
    expect(html).toContain('68.40');
    expect(html).toContain('₱/L');
    expect(html).toContain('font-mono');
    expect(html).toContain('tabular-nums');
  });

  it('shows a stale marker only when stale is true', () => {
    const fresh = renderToStaticMarkup(<GaugeReadout label="Deposit balance" value="120.00" />);
    expect(fresh).not.toContain('stale');

    const stale = renderToStaticMarkup(
      <GaugeReadout label="Deposit balance" value="120.00" stale staleLabel="last known" />,
    );
    expect(stale).toContain('last known');
    expect(stale).toContain('bg-weather-stale');
  });

  it('renders a trend glyph when trend is provided', () => {
    const html = renderToStaticMarkup(<GaugeReadout label="Utilization" value="82" unit="%" trend="up" />);
    expect(html).toContain('↑');
  });
});
