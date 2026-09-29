import { useEffect, useState } from 'react';
import type { PushPublicKeyResponse } from '@arkilaunch/shared';
import { apiGet, apiPost } from '../lib/api-client.js';
import { Surface } from './surface.js';
import { Button } from './button.js';


type State = 'loading' | 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

function base64UrlToBytes(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function PushAlertsToggle() {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) return setState('unsupported');
      try {
        const { publicKey: key } = await apiGet<PushPublicKeyResponse>('/notifications/push/public-key');
        if (cancelled) return;
        if (!key) return setState('unconfigured');
        setPublicKey(key);
        if (Notification.permission === 'denied') return setState('denied');
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const existing = await registration?.pushManager.getSubscription();
        // Re-register so the subscription belongs to whoever is signed in now.
        const registered = existing
          ? await apiPost('/notifications/push-subscriptions', existing.toJSON()).then(() => true, () => false)
          : false;
        if (!cancelled) setState(registered ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('unconfigured');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    let subscription: PushSubscription | undefined;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      await apiPost('/notifications/push-subscriptions', subscription.toJSON());
      setState('on');
    } catch {
      await subscription?.unsubscribe().catch(() => false);
      setError('Alerts could not be turned on for this device. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiPost('/notifications/push-subscriptions/remove', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState('off');
    } catch {
      setError('Alerts could not be turned off. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'unsupported' || state === 'unconfigured') return null;

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text">Weather alerts on this device</h2>
        <p className="text-sm text-text-muted">
          {state === 'on'
            ? 'This device gets a pop-up when the weather puts a machine on your site at Caution or Stop work.'
            : state === 'denied'
              ? 'Notifications are blocked for this site in your browser settings. Allow them there to get weather pop-ups.'
              : 'Get a pop-up when the weather puts a machine on your site at Caution or Stop work. On iPhone, add this site to your Home Screen first (iOS 16.4 or later).'}
        </p>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
      {state !== 'denied' && (
        <Button variant={state === 'on' ? 'secondary' : 'primary'} loading={busy} onClick={() => void (state === 'on' ? disable() : enable())}>
          {state === 'on' ? 'Turn off' : 'Turn on'}
        </Button>
      )}
    </Surface>
  );
}
