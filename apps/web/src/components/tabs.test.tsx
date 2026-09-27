import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './tabs.js';
import { Modal } from './modal.js';

type Id = 'a' | 'b' | 'c';
const ITEMS = [
  { id: 'a' as const, label: 'Rentals' },
  { id: 'b' as const, label: 'Trucks', badge: 3 },
  { id: 'c' as const, label: 'Other' },
];

function Harness() {
  const [value, setValue] = useState<Id>('a');
  return <Tabs label="Service" items={ITEMS} value={value} onChange={setValue} />;
}

describe('Tabs', () => {
  it('moves and selects with the arrow keys, wrapping, and keeps one tab in the Tab order', async () => {
    render(<Harness />);
    const rentals = screen.getByRole('tab', { name: 'Rentals' });
    expect(rentals).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Trucks/ })).toHaveAttribute('tabindex', '-1');

    rentals.focus();
    await userEvent.keyboard('{ArrowRight}');
    const trucks = screen.getByRole('tab', { name: /Trucks/ });
    expect(trucks).toHaveFocus();
    expect(trucks).toHaveAttribute('aria-selected', 'true');
    expect(trucks).toHaveAttribute('tabindex', '0');

    await userEvent.keyboard('{End}{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Rentals' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Other' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a count badge beside the label', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Trucks 3' })).toBeInTheDocument();
  });
});

describe('Modal stacking', () => {
  it('lets Escape close only the innermost dialog', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Modal open onClose={outer} title="Drawer">
        <Modal open onClose={inner} title="Confirm">
          <p>sure?</p>
        </Modal>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps focus in a field while the dialog re-renders', async () => {
    function Form() {
      const [text, setText] = useState('');
      // An inline onClose: a new function every render, as callers write it.
      return (
        <Modal open onClose={() => setText('')} title="Invite">
          <label>
            Email
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </Modal>
      );
    }
    render(<Form />);
    const field = screen.getByLabelText('Email');
    await userEvent.click(field);
    await userEvent.keyboard('rhea');
    expect(field).toHaveFocus();
    expect(field).toHaveValue('rhea');
  });
});
