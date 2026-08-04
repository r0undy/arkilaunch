import { createRouter } from '@tanstack/react-router';
import { rootRoute } from './routes/__root.js';

import { publicLayoutRoute } from './routes/_public.js';
import { indexRoute } from './routes/index.js';
import { equipmentRoute } from './routes/equipment.js';
import { equipmentDetailRoute } from './routes/equipment.$equipmentId.js';
import { contactRoute } from './routes/contact.js';
import { helpRoute } from './routes/help.js';
import { termsRoute } from './routes/terms.js';
import { privacyRoute } from './routes/privacy.js';

import { authLayoutRoute } from './routes/_auth.js';
import { loginRoute } from './routes/login.js';
import { registerRoute } from './routes/register.js';
import { registerCompanyRoute } from './routes/register.company.js';
import { registerPendingRoute } from './routes/register.pending.js';

import { accountLayoutRoute } from './routes/_account.js';
import { accountIndexRoute } from './routes/account.index.js';
import { accountBookingsRoute } from './routes/account.bookings.js';
import { accountCartRoute } from './routes/account.cart.js';
import { accountSettingsRoute } from './routes/account.settings.js';
import { accountApplicationsRoute } from './routes/account.applications.js';

import { appLayoutRoute } from './routes/_app.js';
import { appIndexRoute } from './routes/app.index.js';
import { appInventoryRoute } from './routes/app.inventory.js';
import { appDeploymentRoute } from './routes/app.deployment.js';
import { appInsightsRoute } from './routes/app.insights.js';
import { appIncidentsRoute } from './routes/app.incidents.js';
import { appPaymentsRoute } from './routes/app.payments.js';
import { appUsersRoute } from './routes/app.users.js';
import { appSettingsRoute } from './routes/app.settings.js';
import { quotesRoute } from './routes/quotes.js';
import { edtrRoute } from './routes/edtr.js';
import { kycRoute } from './routes/kyc.js';

import { fieldLayoutRoute } from './routes/_field.js';
import { fieldIndexRoute } from './routes/field.index.js';
import { fieldDeploymentRoute } from './routes/field.deployment.js';

export const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([indexRoute, equipmentRoute, equipmentDetailRoute, contactRoute, helpRoute, termsRoute, privacyRoute]),
  authLayoutRoute.addChildren([loginRoute, registerRoute, registerCompanyRoute, registerPendingRoute]),
  accountLayoutRoute.addChildren([
    accountIndexRoute,
    accountBookingsRoute,
    accountCartRoute,
    accountSettingsRoute,
    accountApplicationsRoute,
  ]),
  appLayoutRoute.addChildren([
    appIndexRoute,
    appInventoryRoute,
    appDeploymentRoute,
    appInsightsRoute,
    appIncidentsRoute,
    appPaymentsRoute,
    appUsersRoute,
    appSettingsRoute,
    quotesRoute,
    edtrRoute,
    kycRoute,
  ]),
  fieldLayoutRoute.addChildren([fieldIndexRoute, fieldDeploymentRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
