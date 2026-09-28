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
    expect(weatherClassFor('Mobile Crane')).toBe('lifting');
    expect(weatherClassFor('Crawler Crane')).toBe('lifting');
    expect(weatherClassFor('Boom Lift (Manlift)')).toBe('aerial_work');
    expect(weatherClassFor('Wheel Loader (Payloader)')).toBe('earthmoving');
    expect(weatherClassFor('Generator Set')).toBe('power');
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

// Every type in the live catalog (equipment_types) gets a real risk class;
// only "Others" falls back to general.
const CATALOG = [
  'Air Compressor', 'Asphalt Paver', 'Backhoe Loader', 'Boom Lift (Manlift)', 'Boom Truck', 'Bulldozer',
  'Concrete Pump', 'Crawler Crane', 'Dump Truck', 'Excavator', 'Forklift', 'Generator Set', 'Mini Excavator',
  'Mobile Crane', 'Motor Grader', 'Plate Compactor', 'Pneumatic Tire Roller', 'Road Roller', 'Self-Loading Truck',
  'Skid Steer Loader', 'Transit Mixer', 'Water Truck', 'Wheel Loader (Payloader)',
];

describe('catalog categorization (Philippine site conditions)', () => {
  it('classifies every catalog type; only Others is general', () => {
    for (const name of CATALOG) expect(weatherClassFor(name), name).not.toBe('general');
    expect(weatherClassFor('Others')).toBe('general');
  });

  // The same weather hits each class differently. Rows are real PH site
  // situations; columns are the expected level per class.
  const scenarios: [string, Partial<EquipmentWeatherInputs>, Record<string, string>][] = [
    [
      'amihan/habagat gusts 45 km/h, dry',
      { windKph: 30, gustKph: 45 },
      { aerial_work: 'stop_work', lifting: 'caution', concrete_pumping: 'caution', material_handling: 'caution', earthmoving: 'normal', hauling: 'normal', compaction: 'normal', paving: 'normal', power: 'normal' },
    ],
    [
      'steady light rain 8 mm/h (PAGASA Yellow)',
      { rainMmPerHour: 8 },
      { paving: 'stop_work', aerial_work: 'caution', concrete_pumping: 'caution', compaction: 'caution', lifting: 'advisory', earthmoving: 'advisory', hauling: 'advisory', power: 'normal' },
    ],
    [
      'afternoon thunderstorm',
      { thunderstorm: true },
      { lifting: 'stop_work', aerial_work: 'stop_work', concrete_pumping: 'stop_work', material_handling: 'caution', earthmoving: 'caution', paving: 'caution', power: 'caution', hauling: 'advisory', compaction: 'advisory' },
    ],
    [
      'Tropical Cyclone Wind Signal No. 1',
      { tcws: 1 },
      { lifting: 'stop_work', aerial_work: 'stop_work', concrete_pumping: 'stop_work', material_handling: 'stop_work', earthmoving: 'caution', hauling: 'caution', compaction: 'caution', paving: 'caution', power: 'advisory' },
    ],
    [
      'heavy rain 20 mm/h (PAGASA Orange)',
      { rainMmPerHour: 20 },
      { aerial_work: 'stop_work', concrete_pumping: 'stop_work', compaction: 'stop_work', paving: 'stop_work', lifting: 'caution', material_handling: 'caution', earthmoving: 'caution', hauling: 'caution', power: 'advisory' },
    ],
    [
      'torrential rain 35 mm/h (PAGASA Red)',
      { rainMmPerHour: 35 },
      { lifting: 'stop_work', aerial_work: 'stop_work', earthmoving: 'stop_work', hauling: 'stop_work', compaction: 'stop_work', paving: 'stop_work', power: 'caution' },
    ],
    [
      'Signal No. 3 typhoon',
      { tcws: 3 },
      { lifting: 'stop_work', earthmoving: 'stop_work', hauling: 'stop_work', power: 'stop_work', paving: 'stop_work' },
    ],
  ];

  for (const [name, weather, expected] of scenarios) {
    it(name, () => {
      for (const [cls, level] of Object.entries(expected)) {
        const got = evaluateEquipmentWeather(cls as never, { ...calm, heatIndexC: null, ...weather }).level;
        expect(got, `${cls} in ${name}`).toBe(level);
      }
    });
  }

  it('no two machine classes share the same risk profile across the scenarios', () => {
    const classes = ['lifting', 'aerial_work', 'concrete_pumping', 'material_handling', 'earthmoving', 'hauling', 'compaction', 'paving', 'power'] as const;
    const profile = (cls: (typeof classes)[number]) =>
      scenarios.map(([, weather]) => evaluateEquipmentWeather(cls, { ...calm, heatIndexC: null, ...weather }).level).join(',');
    const profiles = classes.map(profile);
    expect(new Set(profiles).size).toBe(classes.length);
  });

  it('heat index applies to every operator, whatever the machine', () => {
    expect(evaluateEquipmentWeather('earthmoving', { ...calm, heatIndexC: 44 }).level).toBe('caution');
    expect(evaluateEquipmentWeather('power', { ...calm, heatIndexC: 53 }).level).toBe('stop_work');
  });
});
