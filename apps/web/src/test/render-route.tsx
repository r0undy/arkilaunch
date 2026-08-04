import { expect } from 'vitest';
import { render, waitFor, type RenderResult } from '@testing-library/react';
import { createMemoryHistory, createRouter, RouterProvider, type AnyRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from '../router.js';

// Drives the REAL route tree (not a stub) through createMemoryHistory, so a
// route-level test exercises the actual beforeLoad guards and validateSearch
// exactly as the browser would, without needing a browser.
export async function renderRoute(
  initialPath: string,
): Promise<RenderResult & { router: AnyRouter }> {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(router.state.status).toBe('idle'));

  return { ...result, router };
}
