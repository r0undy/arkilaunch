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
import { accountInvoiceRoute } from './routes/account.invoice.js';
import { accountCheckoutRoute } from './routes/account.checkout.js';
import {
  accountBookingRoute,
  accountBookingExtendRoute,
} from './routes/account.booking.js';
import { accountCheckoutSuccessRoute } from './routes/account.checkout.success.js';

import { appLayoutRoute } from './routes/_app.js';
import { appIndexRoute } from './routes/app.index.js';
import { appInventoryRoute } from './routes/app.inventory.js';
import { appDeploymentRoute } from './routes/app.deployment.js';
import { appInsightsRoute } from './routes/app.insights.js';
import { appIncidentsRoute } from './routes/app.incidents.js';
import { appPaymentsRoute } from './routes/app.payments.js';
import { appBillingWeeklyRoute } from './routes/app.billing.weekly.js';
import { appUsersRoute } from './routes/app.users.js';
import { appSettingsRoute } from './routes/app.settings.js';
import { appPlatformApplicationsRoute } from './routes/app.platform-applications.js';
import { quotesRoute } from './routes/quotes.js';
import { edtrRoute } from './routes/edtr.js';
import { kycRoute } from './routes/kyc.js';
import {
  appCompaniesPendingRoute,
  appCompaniesApprovedRoute,
  appCompanyApplicationRoute,
} from './routes/app.companies.js';
import {
  appRegistrationPendingRoute,
  appRegistrationVerifiedRoute,
  appRegistrationReviewRoute,
} from './routes/app.registration.queues.js';

import { fieldLayoutRoute } from './routes/_field.js';
import { fieldIndexRoute } from './routes/field.index.js';
import { fieldDeploymentRoute } from './routes/field.deployment.js';
import {
  appNotificationsRoute,
  accountNotificationsRoute,
  fieldNotificationsRoute,
} from './routes/notifications.js';
import { appProfileRoute, fieldProfileRoute } from './routes/profile.js';
import {
  appTicketsRoute,
  appSecurityLogsRoute,
  fieldSettingsRoute,
  accountCompanyNewRoute,
  accountNegotiationRoute,
  accountNegotiationChatRoute,
  accountNegotiationCallRoute,
  accountNegotiationFinalRoute,
} from './routes/unbacked-screens.js';

export const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([indexRoute, equipmentRoute, equipmentDetailRoute, contactRoute, helpRoute, termsRoute, privacyRoute]),
  authLayoutRoute.addChildren([loginRoute, registerRoute, registerCompanyRoute, registerPendingRoute]),
  accountLayoutRoute.addChildren([
    accountIndexRoute,
    accountBookingsRoute,
    accountCartRoute,
    accountSettingsRoute,
    accountApplicationsRoute,
    accountInvoiceRoute,
    accountCheckoutRoute,
    accountCheckoutSuccessRoute,
    accountNotificationsRoute,
    accountBookingRoute,
    accountBookingExtendRoute,
    accountCompanyNewRoute,
    accountNegotiationRoute,
    accountNegotiationChatRoute,
    accountNegotiationCallRoute,
    accountNegotiationFinalRoute,
  ]),
  appLayoutRoute.addChildren([
    appIndexRoute,
    appInventoryRoute,
    appDeploymentRoute,
    appInsightsRoute,
    appIncidentsRoute,
    appPaymentsRoute,
    appBillingWeeklyRoute,
    appUsersRoute,
    appSettingsRoute,
    appPlatformApplicationsRoute,
    quotesRoute,
    edtrRoute,
    kycRoute,
    appRegistrationPendingRoute,
    appRegistrationVerifiedRoute,
    appRegistrationReviewRoute,
    appCompaniesPendingRoute,
    appCompaniesApprovedRoute,
    appCompanyApplicationRoute,
    appNotificationsRoute,
    appProfileRoute,
    appTicketsRoute,
    appSecurityLogsRoute,
  ]),
  fieldLayoutRoute.addChildren([
    fieldIndexRoute,
    fieldDeploymentRoute,
    fieldNotificationsRoute,
    fieldProfileRoute,
    fieldSettingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
