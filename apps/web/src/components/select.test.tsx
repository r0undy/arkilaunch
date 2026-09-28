import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './select.js';
import { Modal } from './modal.js';

function Controlled({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <Select
      label="Equipment"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
      }}
    >
      <option value="">Any equipment</option>
      <option value="crane">Crane</option>
      <option value="dozer" disabled>
        Dozer
      </option>
      <option value="excavator">Excavator</option>
    </Select>
  );
}

describe('Select', () => {
  it('opens with the keyboard, skips disabled options and picks with Enter', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'Equipment' });
    expect(box).toHaveTextContent('Any equipment');

    box.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('excavator');
    expect(box).toHaveTextContent('Excavator');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape without changing, and picks by click', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'Equipment' });
    await userEvent.click(box);
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(box);
    await userEvent.click(screen.getByRole('option', { name: 'Crane' }));
    expect(onChange).toHaveBeenCalledWith('crane');
  });

  it('jumps by type-ahead', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    screen.getByRole('combobox', { name: 'Equipment' }).focus();
    await userEvent.keyboard('ex');
    expect(screen.getByRole('option', { name: 'Excavator' }).id).toBe(
      screen.getByRole('combobox').getAttribute('aria-activedescendant'),
    );
  });

  it('submits its value by name, uncontrolled', async () => {
    let data: FormData | null = null;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          data = new FormData(e.currentTarget);
        }}
      >
        <Select label="Fuel type" name="fuel" defaultValue="Diesel">
          <option>Gasoline</option>
          <option>Diesel</option>
        </Select>
        <button type="submit">Save</button>
      </form>,
    );
    const box = screen.getByRole('combobox', { name: 'Fuel type' });
    expect(box).toHaveTextContent('Diesel');
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('option', { name: 'Gasoline' }));
    expect(box).toHaveTextContent('Gasoline');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(data!.get('fuel')).toBe('Gasoline');
  });

  it('in a dialog, Escape closes the menu and leaves the dialog open', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Add" onClose={onClose}>
        <Controlled onChange={() => {}} />
      </Modal>,
    );
    const box = screen.getByRole('combobox', { name: 'Equipment' });
    box.focus();
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
