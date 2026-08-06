import { describe, expect, it } from 'vitest';
import { fleetUtilizationPct } from './queries.js';
import type { UtilizationReportResponse } from '@arkilaunch/shared';

function unit(utilizationPct: number) {
  return {
    equipmentId: '00000000-0000-0000-0000-000000000000',
    runtimeHours: 0,
    utilizationPct,
    maintenanceDue: false,
  };
}

describe('fleetUtilizationPct', () => {
  it('returns null when there is no report', () => {
    expect(fleetUtilizationPct(undefined)).toBeNull();
  });

  it('returns null when the fleet is empty', () => {
    const report: UtilizationReportResponse = { period: { from: '', to: '' }, fleet: [] };
    expect(fleetUtilizationPct(report)).toBeNull();
  });

  it('averages utilizationPct across the fleet', () => {
    const report: UtilizationReportResponse = {
      period: { from: '', to: '' },
      fleet: [unit(80), unit(60), unit(100)],
    };
    expect(fleetUtilizationPct(report)).toBe(80);
  });
});
