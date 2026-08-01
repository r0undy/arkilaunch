import { createRouter } from '@tanstack/react-router';
import { rootRoute } from './routes/__root.js';
import { indexRoute } from './routes/index.js';
import { loginRoute } from './routes/login.js';
import { quotesRoute } from './routes/quotes.js';
import { edtrRoute } from './routes/edtr.js';
import { kycRoute } from './routes/kyc.js';

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, quotesRoute, edtrRoute, kycRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
