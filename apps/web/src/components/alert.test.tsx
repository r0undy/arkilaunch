import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './alert.js';

describe('Alert', () => {
  it('interrupts for an error and stays polite otherwise', () => {
    render(
      <>
        <Alert type="error">Could not save.</Alert>
        <Alert type="warning" header="Heavy rain">Deliveries may slip.</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
    expect(screen.getByRole('status')).toHaveTextContent('Heavy rainDeliveries may slip.');
  });
});
