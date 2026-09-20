import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';

// The catalog rendered the whole fleet as one grid. The failure worth a test
// is not the arithmetic of a page range -- it is the dead end: Pagination
// hides itself on a single page, so an offset left over from a wider result
// would strand the reader on an empty grid with no control to escape it.

const FLEET = Array.from({ length: 45 }, (_, i) => ({
  id: `eq-${i}`,
  model: i === 0 ? 'Solitary Dragline' : `CAT 32${i}D`,
  equipmentTypeName: 'Excavator',
  availabilityStatus: 'available',
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const json = (v: unknown) =>
        Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/catalog/equipment')) return json({ items: FLEET, total: FLEET.length });
      return json({ items: [], total: 0 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('Equipment catalog', () => {
  it('shows one page of machines at a time', async () => {
    await renderRoute('/equipment');

    await waitFor(() => expect(screen.getByText('Solitary Dragline')).toBeInTheDocument());
    expect(screen.getByText(/Showing 1-20 of 45 machines/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(20);

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Showing 21-40 of 45 machines/)).toBeInTheDocument();
    expect(screen.queryByText('Solitary Dragline')).not.toBeInTheDocument();
  });

  it('does not strand the reader past the end when a filter narrows the result', async () => {
    await renderRoute('/equipment');
    await waitFor(() => expect(screen.getByText('Solitary Dragline')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Showing 21-40 of 45 machines/)).toBeInTheDocument();

    // One match, which lives on what is now page 1. Before the offset was
    // clamped this rendered an empty grid with the pager gone.
    await userEvent.type(screen.getByRole('searchbox'), 'Solitary');
    await waitFor(() => expect(screen.getByText('Solitary Dragline')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('says so when nothing matches, rather than rendering a blank grid', async () => {
    await renderRoute('/equipment');
    await waitFor(() => expect(screen.getByText('Solitary Dragline')).toBeInTheDocument());

    await userEvent.type(screen.getByRole('searchbox'), 'no-such-machine');
    expect(await screen.findByText('No equipment matches that search.')).toBeInTheDocument();
  });
});
