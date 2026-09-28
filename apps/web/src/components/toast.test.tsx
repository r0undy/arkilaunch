import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './toast.js';

function Fire() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.success('Saved')}>
      fire
    </button>
  );
}

describe('Flashbar', () => {
  it('holds a success message while the pointer is on it', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Fire />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'fire' }));
      const bar = screen.getByText('Saved').closest('div')!.parentElement!;
      fireEvent.mouseEnter(bar);
      act(() => vi.advanceTimersByTime(6000));
      expect(screen.getByText('Saved')).toBeInTheDocument();
      fireEvent.mouseLeave(bar);
      act(() => vi.advanceTimersByTime(6000));
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
