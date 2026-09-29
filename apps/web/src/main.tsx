import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router.js';
import { ApiError } from './lib/api-client.js';
import { bootstrapSession, watchSessionOwner } from './lib/auth-client.js';
import { ToastProvider } from './components/toast.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // The 401 interceptor owns token refresh; a 4xx will not succeed on retry.
      retry: (failureCount, error) =>
        failureCount < 2 &&
        !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

// The access token is memory-only: rehydrate before the router's guards run, or authed reloads bounce to /login.
watchSessionOwner();
bootstrapSession().finally(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
