import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EquipmentWeatherList } from './equipment-weather.js';

describe('EquipmentWeatherList', () => {
  it('credits Open-Meteo (CC BY 4.0) wherever its readings show', () => {
    render(
      <EquipmentWeatherList
        data={{ level: 'normal', polledAt: null, isStale: false, pagasa: null, equipment: [] } as never}
      />,
    );
    expect(screen.getByRole('link', { name: /open-meteo/i })).toHaveAttribute('href', 'https://open-meteo.com/');
  });
});
