import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Table, type TableColumn } from './table.js';

type Row = { id: string; name: string; status: string; total: string };
const rows: Row[] = [{ id: '1', name: 'Crane 40T', status: 'Paid', total: '₱1,200' }];
const columns: TableColumn<Row>[] = [
  { header: 'Name', kind: 'text', cell: (r) => r.name },
  { header: 'Total', kind: 'money', cell: (r) => r.total },
  { header: 'Status', kind: 'status', cell: (r) => r.status },
];

function narrowScreen(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('Table', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a table on a wide screen', () => {
    narrowScreen(false);
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('turns each row into a card on a phone', () => {
    narrowScreen(true);
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('Crane 40T');
    expect(card).toHaveTextContent('Paid');
    // The rest of the columns are labelled pairs; title and status are not repeated there.
    const pairs = within(card).getByRole('definition');
    expect(pairs).toHaveTextContent('₱1,200');
    expect(within(card).getByText('Total')).toBeInTheDocument();
    expect(within(card).queryByText('Name')).not.toBeInTheDocument();
  });
});
