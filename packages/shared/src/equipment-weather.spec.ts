import { describe, expect, it } from 'vitest';
import { assessEquipmentWeather, rainfallWarningFromRate, weatherCategoryFor } from './equipment-weather.js';

const calm = { tempC: 30, windKph: 10, precipMm: 0, code: 1 };

describe('weatherCategoryFor', () => {
  it('files each type under its weather category, lifting first', () => {
    expect(weatherCategoryFor('Mobile Crane 25T')).toBe('lifting');
    expect(weatherCategoryFor('Excavator 20T')).toBe('earthmoving');
    expect(weatherCategoryFor('Dump Truck')).toBe('haulage');
    expect(weatherCategoryFor('Vibratory Roller')).toBe('compaction_paving');
    expect(weatherCategoryFor('Generator 100 kVA')).toBe('power');
    expect(weatherCategoryFor('Others')).toBe('other');
  });
});

describe('assessEquipmentWeather', () => {
  it('stops a crane at a wind an excavator only works through', () => {
    const windy = { ...calm, windKph: 40 };
    expect(assessEquipmentWeather('lifting', windy).level).toBe('stop_work');
    expect(assessEquipmentWeather('earthmoving', windy).level).toBe('normal');
  });

  it('reads the gust, not only the sustained wind', () => {
    expect(assessEquipmentWeather('lifting', { ...calm, windKph: 20, gustKph: 39 }).level).toBe('stop_work');
  });

  it('follows the PAGASA wind signals: Signal 2 stops lifting, Signal 3 stops everything', () => {
    expect(assessEquipmentWeather('lifting', calm, { tcws: 1, rainfallWarning: 'none', thunderstorm: false }).level).toBe('caution');
    expect(assessEquipmentWeather('earthmoving', calm, { tcws: 1, rainfallWarning: 'none', thunderstorm: false }).level).toBe('advisory');
    expect(assessEquipmentWeather('lifting', calm, { tcws: 2, rainfallWarning: 'none', thunderstorm: false }).level).toBe('stop_work');
    expect(assessEquipmentWeather('haulage', calm, { tcws: 3, rainfallWarning: 'none', thunderstorm: false }).level).toBe('stop_work');
  });

  it('uses the PAGASA rainfall colours, from a warning or the measured rate', () => {
    expect(rainfallWarningFromRate(10)).toBe('yellow');
    expect(assessEquipmentWeather('earthmoving', { ...calm, precipMm: 20 }).level).toBe('stop_work');
    expect(assessEquipmentWeather('haulage', { ...calm, precipMm: 20 }).level).toBe('caution');
    expect(assessEquipmentWeather('haulage', calm, { tcws: 0, rainfallWarning: 'red', thunderstorm: false }).level).toBe('stop_work');
  });

  it('stops lifting for lightning, from an advisory or a thunderstorm code', () => {
    expect(assessEquipmentWeather('lifting', { ...calm, code: 95 }).level).toBe('stop_work');
    expect(assessEquipmentWeather('earthmoving', { ...calm, code: 95 }).level).toBe('caution');
  });

  it('applies the heat index bands to every operator', () => {
    const hot = assessEquipmentWeather('power', { ...calm, heatIndexC: 45 });
    expect(hot.level).toBe('caution');
    expect(hot.reasons[0]).toContain('danger');
  });

  it('is normal, with no reasons, in calm weather', () => {
    expect(assessEquipmentWeather('lifting', calm)).toEqual({ level: 'normal', reasons: [] });
  });
});
