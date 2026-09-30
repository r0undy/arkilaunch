import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionMenu } from './action-menu.js';

describe('ActionMenu', () => {
  it('opens by keyboard, selects an action, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    render(<ActionMenu label="More actions for machine" items={[{ label: 'Edit details', onSelect: edit }, { label: 'Retire equipment', onSelect: vi.fn(), destructive: true }]} />);
    const trigger = screen.getByRole('button', { name: 'More actions for machine' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveFocus();
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    expect(edit).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });
});
