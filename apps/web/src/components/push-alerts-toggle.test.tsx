import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PushAlertsToggle } from './push-alerts-toggle.js';

const SUB_JSON = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

function stubPush(existing: boolean) {
  const subscription = { endpoint: SUB_JSON.endpoint, toJSON: () => SUB_JSON, unsubscribe: vi.fn().mockResolvedValue(true) };
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing ? subscription : null),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: () => Promise.resolve('granted') });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({ pushManager }), register: () => Promise.resolve({ pushManager }), ready: Promise.resolve() },
  });
  return subscription;
}

function stubFetch(subscribeStatus: number) {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      String(url).includes('public-key')
        ? new Response(JSON.stringify({ publicKey: 'AQID' }), { status: 200 })
        : new Response('{}', { status: subscribeStatus }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('PushAlertsToggle', () => {
  it('re-registers an existing subscription for the signed-in user before showing it as on', async () => {
    stubPush(true);
    const fetchMock = stubFetch(200);
    render(<PushAlertsToggle />);

    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/notifications/push-subscriptions'));
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual(SUB_JSON);
  });

  it('unsubscribes the browser when the server refuses the new subscription', async () => {
    const subscription = stubPush(false);
    stubFetch(500);
    render(<PushAlertsToggle />);

    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));

    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalled());
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be turned on/i);
  });
});
