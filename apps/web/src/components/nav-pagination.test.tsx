import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { activeNavTarget } from './nav-group.js';
import { Pagination } from './pagination.js';

describe('activeNavTarget', () => {
  const targets = ['/app', '/app/deployment', '/app/ocr', '/app/users'];

  it('marks only the most specific destination, not every ancestor', () => {
    // The bug this replaces: `/app` also matched `/app/ocr` by prefix, so the
    // section root and the page both showed as active.
    expect(activeNavTarget(targets, '/app/ocr')).toBe('/app/ocr');
  });

  it('marks the section root when that is genuinely the page', () => {
    expect(activeNavTarget(targets, '/app')).toBe('/app');
  });

  it('matches a child route of a destination', () => {
    expect(activeNavTarget(targets, '/app/users/42')).toBe('/app/users');
  });

  it('does not match on a shared prefix that is not a path boundary', () => {
    expect(activeNavTarget(['/app/user'], '/app/users')).toBeNull();
  });

  it('returns nothing when the URL belongs to no destination', () => {
    expect(activeNavTarget(targets, '/account')).toBeNull();
  });

  // The bug: `/account` is a prefix of every page in the section, so the cart,
  // the checkout, the invoice and the company form all lit "Home".
  describe('a section root marked exact', () => {
    const accountNav = [
      { to: '/account', exact: true },
      { to: '/account/bookings', owns: ['/account/checkout', '/account/invoices'] },
      { to: '/account/companies' },
    ];

    it('lights only on the root itself', () => {
      expect(activeNavTarget(accountNav, '/account')).toBe('/account');
      expect(activeNavTarget(accountNav, '/account/cart')).toBeNull();
    });

    it('still lets a more specific destination match its children', () => {
      expect(activeNavTarget(accountNav, '/account/companies/new')).toBe('/account/companies');
    });

    it('lets a destination own screens with no sidebar entry', () => {
      expect(activeNavTarget(accountNav, '/account/checkout/abc')).toBe('/account/bookings');
      expect(activeNavTarget(accountNav, '/account/invoices/abc')).toBe('/account/bookings');
    });

    it('ranks by the matching prefix, so a longer owns beats a shorter to', () => {
      const nav = [{ to: '/a' }, { to: '/b', owns: ['/a/deep/branch'] }];
      expect(activeNavTarget(nav, '/a/deep/branch/x')).toBe('/b');
    });
  });
});

describe('Pagination', () => {
  it('stays out of the way when everything fits on one page', () => {
    const { container } = render(
      <Pagination
        offset={0}
        limit={20}
        total={12}
        onOffsetChange={() => undefined}
        noun="rate cards"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reports the range and the total, not just a page number', () => {
    render(
      <Pagination
        offset={20}
        limit={20}
        total={63}
        onOffsetChange={() => undefined}
        noun="field logs"
      />,
    );
    expect(screen.getByText(/showing 21-40 of 63 field logs/i)).toBeInTheDocument();
    expect(screen.getByText(/page 2 of 4/i)).toBeInTheDocument();
  });

  it('cannot go back from the first page, or forward from the last', async () => {
    const onOffsetChange = vi.fn();
    const { rerender } = render(
      <Pagination offset={0} limit={20} total={30} onOffsetChange={onOffsetChange} noun="people" />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onOffsetChange).toHaveBeenCalledWith(20);

    rerender(
      <Pagination
        offset={20}
        limit={20}
        total={30}
        onOffsetChange={onOffsetChange}
        noun="people"
      />,
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('never offers a negative offset', async () => {
    const onOffsetChange = vi.fn();
    render(
      <Pagination offset={10} limit={20} total={40} onOffsetChange={onOffsetChange} noun="sites" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onOffsetChange).toHaveBeenCalledWith(0);
  });
});
