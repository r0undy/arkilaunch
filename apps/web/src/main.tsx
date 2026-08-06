import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router.js';
import { ApiError } from './lib/api-client.js';
import { bootstrapSession } from './lib/auth-client.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // The auth-client 401 interceptor already owns retrying an expired
      // access token; retrying a 4xx here would just repeat a request that
      // is never going to succeed (e.g. a 403 permission denial).
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

// The access token now lives in memory only (RFC-1 §3), so a reload starts
// with none -- rehydrate it from the refresh token before the router's own
// guards run, or every reload of an authed route bounces to /login.
bootstrapSession().finally(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
});
