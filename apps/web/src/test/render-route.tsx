import { expect } from 'vitest';
import { render, waitFor, type RenderResult } from '@testing-library/react';
import { createMemoryHistory, createRouter, RouterProvider, type AnyRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from '../router.js';
import { ToastProvider } from '../components/toast.js';

export async function renderRoute(
  initialPath: string,
): Promise<RenderResult & { router: AnyRouter }> {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history });

  const result = render(
    // Mirrors main.tsx: useToast throws without the provider.
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(router.state.status).toBe('idle'));

  return { ...result, router };
}
