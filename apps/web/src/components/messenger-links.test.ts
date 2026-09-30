import { describe, expect, it } from 'vitest';
import { messengerHrefs } from './messenger-links.js';

describe('messengerHrefs', () => {
  it('builds Viber and Telegram links for any PH mobile format', () => {
    for (const raw of ['09693630615', '+63 969 363 0615', '639693630615']) {
      expect(messengerHrefs(raw)).toEqual({ viber: 'viber://call?number=%2B639693630615', telegram: 'https://t.me/+639693630615' });
    }
  });
  it('returns null for landlines and empty values so tel: stays the only option', () => {
    for (const raw of ['0281234567', '', null, undefined]) expect(messengerHrefs(raw)).toBeNull();
  });
});
