import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const modalProps: Array<{ submitOnly?: boolean }> = [];
vi.mock('../components/capture-modal.js', () => ({
  CaptureModal: (props: { submitOnly?: boolean }) => {
    modalProps.push(props);
    return null;
  },
}));
vi.mock('../lib/use-scan-deployments.js', () => ({
  useScanDeployments: () => ({ rentals: [], equipmentList: [], rentalLabel: () => '', error: null }),
}));
vi.mock('../components/page-header.js', () => ({ PageHeader: () => null }));
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => {},
}));

const { appOcrDeploymentsRoute, fieldScanRoute } = await import('./app.ocr.deployments.js');

function renderRoute(route: { options: { component?: unknown } }) {
  modalProps.length = 0;
  const Component = route.options.component as () => React.ReactElement;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Component />
    </QueryClientProvider>,
  );
  return modalProps.at(-1);
}

// A timekeeper holds edtr:create only; polling GET /edtr/:id would 403 into an error box after a good capture.
describe('DTR scanning routes', () => {
  it('the field scan page only submits, and the staff page polls', () => {
    expect(renderRoute(fieldScanRoute)?.submitOnly).toBe(true);
    expect(renderRoute(appOcrDeploymentsRoute)?.submitOnly).toBe(false);
  });
});
