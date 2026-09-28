import { describe, expect, it } from 'vitest';
import { hourRanges, weatherEmail, weatherNoticePath, weatherNoticeText } from './weather-notify.js';

const crane = {
  equipmentId: 'e1',
  rentalId: 'r1',
  equipmentName: 'Crane 25t',
  equipmentType: 'Crane',
  level: 'stop_work' as const,
  reasons: ['Gusts 70 km/h'],
  hours: ['14:00', '13:00', '16:00'],
};
const briefing = { project_site_id: 's1', site_name: 'Lot 5, Pasig', level: 'stop_work', machines: [crane] };

describe('hourRanges', () => {
  it('joins consecutive hours and keeps gaps', () => {
    expect(hourRanges(['09:00', '13:00', '14:00', '15:00'])).toBe('09:00, 13:00-15:00');
    expect(hourRanges([])).toBe('');
  });
});

describe('weatherNoticeText', () => {
  it('lists each at-risk machine with its hours and reasons', () => {
    const { title, body } = weatherNoticeText('equipment_weather_briefing', briefing, 'staff');
    expect(title).toBe("Today's weather at Lot 5, Pasig: Stop work");
    expect(body).toContain('Crane 25t - Stop work (13:00-14:00, 16:00): Gusts 70 km/h');
  });

  it('asks the timekeeper to brief the crew and tells the customer the timekeeper knows', () => {
    expect(weatherNoticeText('equipment_weather_briefing', briefing, 'timekeeper').body).toContain('Brief the operators');
    expect(weatherNoticeText('equipment_weather_briefing', briefing, 'customer').body).toContain('your timekeeper');
  });

  it('leaves out machines below Caution', () => {
    const calm = { ...crane, equipmentName: 'Roller', level: 'advisory' as const };
    expect(weatherNoticeText('equipment_weather_outlook', { ...briefing, machines: [crane, calm] }, 'staff').body).not.toContain('Roller');
  });

  it('words the live warning per machine', () => {
    const { title, body } = weatherNoticeText(
      'equipment_weather_alert',
      { site_name: 'Lot 5', equipment_name: 'Crane 25t', level: 'caution', reasons: ['Rain 8 mm/h'] },
      'timekeeper',
    );
    expect(title).toBe('CAUTION: Crane 25t');
    expect(body).toContain('Rain 8 mm/h');
  });
});

describe('weatherNoticePath / weatherEmail', () => {
  it('links each audience to its own console', () => {
    expect(weatherNoticePath('customer', briefing)).toBe('/account/bookings/r1');
    expect(weatherNoticePath('timekeeper', briefing)).toBe('/field');
    expect(weatherNoticePath('staff', briefing)).toBe('/app/deployment/s1');
  });

  it('ends the email in a button link and states the review-not-charge policy', () => {
    const mail = weatherEmail('equipment_weather_briefing', briefing, 'customer', 'https://acme.arkilaunch.app/');
    expect(mail.text).toContain('Open: https://acme.arkilaunch.app/account/bookings/r1');
    expect(mail.text).toContain('never charged automatically');
  });
});
