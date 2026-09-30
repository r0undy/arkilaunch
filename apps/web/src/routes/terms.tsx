import { createRoute } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';
import { EmptyState } from '../components/empty-state.js';

// Checkout links to #weather-monitoring.
function TermsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-10">
      <EmptyState title="Terms of service" description="Legal terms are being drafted and will be published here before public launch." />

      <section id="weather-monitoring" aria-labelledby="weather-monitoring-title" className="flex flex-col gap-3 text-text">
        <h2 id="weather-monitoring-title" className="text-heading-md">
          Weather monitoring and verification
        </h2>
        <p className="text-sm">
          Every project site with our equipment on it is monitored for weather for as long as the equipment is deployed there.
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <strong>Before the workday</strong>, we check the forecast for your site. Each machine is judged by its own weather risk,
            because a crane is affected by wind that a roller is not.
          </li>
          <li>
            <strong>During the day</strong>, the site's weather is recorded every 30 minutes. When rain or other bad weather is
            expected, we re-check the forecast every hour.
          </li>
          <li>
            <strong>If the weather may affect a machine</strong>, we notify your assigned timekeeper, you, and our staff in the app,
            by email, and by browser alert if you turned alerts on. The timekeeper can then brief the crew. Deciding whether to work
            stays with you and your site safety officer.
          </li>
          <li>
            <strong>Daily time records (EDTR)</strong> are compared with the recorded weather for your site. This covers whether it
            rained, how hard, whether it kept raining, and whether the machine was still used. We also check whether work continued
            after a Stop work warning.
          </li>
          <li>
            <strong>Anything that does not match is flagged for review by a person</strong> and noted in the site's incident log.
            A flag is not a finding that an incident happened. It never changes your bill or deposit automatically.
          </li>
        </ul>
        <p className="text-sm text-text-muted">
          Weather data: Open-Meteo (CC BY 4.0). Forecasts can be wrong, so always follow what you see on site and any PAGASA warnings.
        </p>
      </section>
    </div>
  );
}

export const termsRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/terms',
  component: TermsPage,
});
