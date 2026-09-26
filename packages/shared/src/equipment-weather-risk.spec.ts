import { describe, expect, it } from 'vitest';
import {
  applyOverride,
  classifyEquipmentType,
  DEFAULT_RISK_PROFILES,
  evaluateEquipmentRisk,
  findWeatherBreaches,
  heatIndexC,
} from './equipment-weather-risk.js';

const calm = { tempC: 28, windKph: 5, precipMm: 0, code: 1, humidityPct: 50 };

describe('classifyEquipmentType', () => {
  it.each([
    ['Mobile Crane', 'lifting'],
    ['Crane Truck', 'lifting'],
    ['Boom Lift', 'aerial'],
    ['Scissor Lift', 'aerial'],
    ['Backhoe Loader', 'earthmoving'],
    ['Road Roller', 'paving'],
    ['Dump Truck', 'hauling'],
    ['Generator', 'general'],
  ])('%s -> %s', (name, cls) => {
    expect(classifyEquipmentType(name)).toBe(cls);
  });
});

describe('evaluateEquipmentRisk', () => {
  it('is normal in calm weather', () => {
    const r = evaluateEquipmentRisk(calm, 'lifting');
    expect(r.level).toBe('normal');
    expect(r.reasons).toEqual([]);
    expect(r.customerMessage).toBe('Weather is fine for this machine.');
  });

  it('stops a crane in wind an excavator can work through', () => {
    const windy = { ...calm, windKph: 30, gustKph: 46 };
    expect(evaluateEquipmentRisk(windy, 'lifting').level).toBe('red');
    expect(evaluateEquipmentRisk(windy, 'earthmoving').level).toBe('yellow');
  });

  it('uses PAGASA rain bands, stricter for paving', () => {
    const rain = { ...calm, precipMm: 8 };
    expect(evaluateEquipmentRisk(rain, 'earthmoving').level).toBe('yellow');
    expect(evaluateEquipmentRisk(rain, 'paving').level).toBe('orange');
  });

  it('treats lightning as red for tall machines, orange for the rest', () => {
    const storm = { ...calm, code: 95 };
    expect(evaluateEquipmentRisk(storm, 'aerial').level).toBe('red');
    expect(evaluateEquipmentRisk(storm, 'hauling').level).toBe('orange');
  });

  it('lists the worst hazard first and speaks plainly to the customer', () => {
    const r = evaluateEquipmentRisk({ ...calm, windKph: 50, precipMm: 8 }, 'lifting');
    expect(r.reasons.map((x) => x.hazard)).toEqual(['wind', 'rain']);
    expect(r.customerMessage).toMatch(/^Wind is too strong/);
    expect(r.customerMessage).not.toMatch(/\d/);
    expect(r.adminSummary).toContain('Wind 50 kph (red)');
  });

  it('flags when heat was checked without humidity', () => {
    expect(evaluateEquipmentRisk({ tempC: 28, windKph: 5, precipMm: 0, code: 1 }, 'general').adminSummary).toContain('without humidity');
  });
});

describe('heatIndexC', () => {
  it('rises above air temperature in humid heat', () => {
    expect(heatIndexC(34, 70)).toBeGreaterThanOrEqual(42);
  });
  it('returns air temperature when cool or humidity unknown', () => {
    expect(heatIndexC(25, 90)).toBe(25);
    expect(heatIndexC(34)).toBe(34);
  });
});

describe('applyOverride', () => {
  it('lets an admin make a profile stricter', () => {
    const p = applyOverride(DEFAULT_RISK_PROFILES.earthmoving, { windKph: { orange: 50 } });
    expect(p.windKph.orange).toBe(50);
  });
  it('never lets an admin make a profile looser', () => {
    const p = applyOverride(DEFAULT_RISK_PROFILES.lifting, { windKph: { red: 80 }, lightning: 'normal' });
    expect(p.windKph.red).toBe(DEFAULT_RISK_PROFILES.lifting.windKph.red);
    expect(p.lightning).toBe('red');
  });
});

describe('findWeatherBreaches', () => {
  const warnings = [
    { equipmentId: 'crane', date: '2026-09-26', level: 'orange' as const, hazards: ['rain' as const] },
    { equipmentId: 'crane', date: '2026-09-26', level: 'red' as const, hazards: ['wind' as const] },
    { equipmentId: 'dozer', date: '2026-09-26', level: 'yellow' as const, hazards: ['wind' as const] },
  ];

  it('flags a unit that worked on a stop day, at the worst level', () => {
    const b = findWeatherBreaches(warnings, [{ equipmentId: 'crane', date: '2026-09-26', hoursActive: 3 }]);
    expect(b).toEqual([{ equipmentId: 'crane', date: '2026-09-26', level: 'red', hazards: ['wind'], hoursActive: 3 }]);
  });

  it('ignores yellow days, idle days and other dates', () => {
    expect(findWeatherBreaches(warnings, [
      { equipmentId: 'dozer', date: '2026-09-26', hoursActive: 8 },
      { equipmentId: 'crane', date: '2026-09-26', hoursActive: 0 },
      { equipmentId: 'crane', date: '2026-09-27', hoursActive: 5 },
    ])).toEqual([]);
  });
});
