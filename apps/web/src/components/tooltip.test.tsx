import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './tooltip.js';

describe('Tooltip', () => {
  it('is closed by default', () => {
    render(
      <Tooltip content="Detail text">
        <span>Trigger</span>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on mouse hover', () => {
    render(
      <Tooltip content="Detail text">
        <span>Trigger</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByTestId('tooltip-root'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Detail text');
  });

  it('opens on keyboard focus, not just mouse hover (DESIGN.md §6: never hover-only)', () => {
    render(
      <Tooltip content="Detail text">
        <span>Trigger</span>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('Trigger'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Detail text');
  });

  it('closes on Escape', () => {
    render(
      <Tooltip content="Detail text">
        <span>Trigger</span>
      </Tooltip>,
    );
    const wrapper = screen.getByTestId('tooltip-root');
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(wrapper, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
