import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Input } from './input.js';

function DateHarness({ dateTime = false }: { dateTime?: boolean }) {
  const [value, setValue] = useState(dateTime ? '2026-10-05T08:30' : '2026-10-05');
  return <Input label="Work date" type={dateTime ? 'datetime-local' : 'date'} value={value} min="2026-10-04" max="2026-10-06T23:59" onChange={(event) => setValue(event.target.value)} />;
}

describe('Date picker', () => {
  it('keeps the chosen value until confirmation and enforces date limits', async () => {
    const user = userEvent.setup();
    render(<DateHarness />);
    const trigger = screen.getByRole('button', { name: /work date/i });
    await user.click(trigger);
    expect(screen.getByRole('button', { name: /october 3, 2026/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /october 6, 2026/i }));
    expect(trigger).toHaveTextContent('Oct 5');
    await user.click(screen.getByRole('button', { name: 'Select date' }));
    expect(trigger).toHaveTextContent('Oct 6');
    expect(trigger).toHaveFocus();
  });

  it('preserves the time when changing the day and cancels on Escape', async () => {
    const user = userEvent.setup();
    render(<DateHarness dateTime />);
    const trigger = screen.getByRole('button', { name: /work date/i });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: /october 6, 2026/i }));
    await user.keyboard('{Escape}');
    expect(trigger).toHaveTextContent('Oct 5');
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: /october 6, 2026/i }));
    await user.click(screen.getByRole('button', { name: 'Select date' }));
    expect(trigger).toHaveTextContent('Oct 6, 2026, 08:30');
  });

  it('moves the focused day with arrow keys', async () => {
    const user = userEvent.setup();
    render(<DateHarness />);
    await user.click(screen.getByRole('button', { name: /work date/i }));
    screen.getByRole('button', { name: /october 5, 2026/i }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /october 6, 2026/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
