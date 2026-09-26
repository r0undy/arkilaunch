import { describe, expect, it } from 'vitest';
import {
  evaluateEquipmentWeather,
  heatIndexC,
  rainfallWarningFor,
  weatherClassFor,
  worstLevel,
  type EquipmentWeatherInputs,
} from './equipment-weather.js';

const calm: EquipmentWeatherInputs = { windKph: 10, gustKph: 15, rainMmPerHour: 0, heatIndexC: 30, thunderstorm: false, tcws: 0, pagasaRainfall: 'none' };

describe('per-equipment PAGASA weather levels', () => {
  it('maps the catalog types onto weather classes', () => {
    expect(weatherClassFor('Crane')).toBe('lifting');
    expect(weatherClassFor('Boom Truck')).toBe('lifting');
    expect(weatherClassFor('Road Roller')).toBe('compaction');
    expect(weatherClassFor('Dump Truck')).toBe('hauling');
    expect(weatherClassFor('Something New')).toBe('general');
  });

  it('uses the PAGASA rainfall colours', () => {
    expect(rainfallWarningFor(5)).toBe('none');
    expect(rainfallWarningFor(7.5)).toBe('yellow');
    expect(rainfallWarningFor(15)).toBe('orange');
    expect(rainfallWarningFor(31)).toBe('red');
  });

  it('is normal in calm weather', () => {
    expect(evaluateEquipmentWeather('lifting', calm)).toEqual({ level: 'normal', reasons: [] });
  });

  it('stops a crane in gusts an excavator works through', () => {
    const gusty = { ...calm, windKph: 35, gustKph: 52 };
    const crane = evaluateEquipmentWeather('lifting', gusty);
    expect(crane.level).toBe('stop_work');
    expect(crane.reasons[0]).toContain('Gusts 52 km/h');
    expect(evaluateEquipmentWeather('earthmoving', gusty).level).toBe('normal');
  });

  it('stops earthmoving in Red rainfall but only limits a generator', () => {
    const red = { ...calm, rainMmPerHour: 35 };
    expect(evaluateEquipmentWeather('earthmoving', red).level).toBe('stop_work');
    expect(evaluateEquipmentWeather('power', red).level).toBe('caution');
  });

  it('takes the PAGASA signal and rainfall warning even when the live reading is calm', () => {
    expect(evaluateEquipmentWeather('lifting', { ...calm, tcws: 1 }).level).toBe('stop_work');
    expect(evaluateEquipmentWeather('hauling', { ...calm, pagasaRainfall: 'orange' }).level).toBe('caution');
  });

  it('stops lifting in a thunderstorm', () => {
    expect(evaluateEquipmentWeather('lifting', { ...calm, thunderstorm: true }).reasons).toContain('Thunderstorm / lightning in the area');
  });

  it('applies the heat index to every operator', () => {
    expect(heatIndexC(34, 70)).toBeGreaterThanOrEqual(42);
    expect(evaluateEquipmentWeather('compaction', { ...calm, heatIndexC: 45 }).level).toBe('caution');
    expect(evaluateEquipmentWeather('compaction', { ...calm, heatIndexC: 53 }).level).toBe('stop_work');
  });

  it('reports only the reasons at the machine level', () => {
    const result = evaluateEquipmentWeather('lifting', { ...calm, gustKph: 55, rainMmPerHour: 8 });
    expect(result.level).toBe('stop_work');
    expect(result.reasons.every((r) => !r.includes('Yellow'))).toBe(true);
  });

  it('takes the worst level for a site', () => {
    expect(worstLevel(['normal', 'caution', 'advisory'])).toBe('caution');
    expect(worstLevel([])).toBe('normal');
  });
});

describe('estimatePagasa', () => {
  it('maps wind to the PAGASA TCWS bands and rain to its colours', async () => {
    const { estimatePagasa } = await import('./equipment-weather.js');
    expect(estimatePagasa({ windKph: 20, gustKph: 30, precipMm: 0, code: 1 })).toEqual({ tcws: 0, rainfall: 'none', thunderstorm: false });
    expect(estimatePagasa({ windKph: 45, precipMm: 8, code: 95 })).toEqual({ tcws: 1, rainfall: 'yellow', thunderstorm: true });
    expect(estimatePagasa({ windKph: 70, gustKph: 95, precipMm: 35, code: 3 }).tcws).toBe(3);
  });
});
