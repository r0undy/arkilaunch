import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { DataPanel } from './data-panel.js';

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DataPanel', () => {
  it('shows loading, then success content', async () => {
    const options = queryOptions({
      queryKey: ['test', 'success'],
      queryFn: () => Promise.resolve(['a', 'b']),
    });

    renderWithClient(
      <DataPanel
        title="Widgets"
        options={options}
        emptyTitle="No widgets"
        emptyDescription="none"
        isEmpty={(data) => data.length === 0}
        render={(data) => <ul>{data.map((d) => <li key={d}>{d}</li>)}</ul>}
      />,
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument());
  });

  it('shows the empty state when isEmpty is true', async () => {
    const options = queryOptions({
      queryKey: ['test', 'empty'],
      queryFn: () => Promise.resolve([] as string[]),
    });

    renderWithClient(
      <DataPanel
        title="Widgets"
        options={options}
        emptyTitle="No widgets yet"
        emptyDescription="Add one."
        isEmpty={(data) => data.length === 0}
        render={(data) => <ul>{data.map((d) => <li key={d}>{d}</li>)}</ul>}
      />,
    );

    await waitFor(() => expect(screen.getByText('No widgets yet')).toBeInTheDocument());
  });

  it('shows an error state with a retry action on failure', async () => {
    const options = queryOptions({
      queryKey: ['test', 'error'],
      queryFn: () => Promise.reject(new Error('boom')),
    });

    renderWithClient(
      <DataPanel
        title="Widgets"
        options={options}
        emptyTitle="No widgets"
        emptyDescription="none"
        isEmpty={() => false}
        render={() => null}
      />,
    );

    await waitFor(() => expect(screen.getByText(/could not load widgets/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('regression: a parent re-render does not cause a refetch (the old fetcher-identity bug)', async () => {
    const queryFn = vi.fn<() => Promise<string[]>>().mockResolvedValue(['x']);
    const options = queryOptions({ queryKey: ['test', 'stable'], queryFn });

    function Wrapper({ tick }: { tick: number }) {
      return (
        <div>
          <span>tick {tick}</span>
          <DataPanel
            title="Widgets"
            options={options}
            emptyTitle="No widgets"
            emptyDescription="none"
            isEmpty={(data) => data.length === 0}
            render={(data) => <ul>{data.map((d) => <li key={d}>{d}</li>)}</ul>}
          />
        </div>
      );
    }

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Wrapper tick={0} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument());
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Re-render the parent with new props (the previous bug: a fresh inline
    // fetcher identity on every render re-triggered the effect).
    rerender(
      <QueryClientProvider client={client}>
        <Wrapper tick={1} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('tick 1')).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
