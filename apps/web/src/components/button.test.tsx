import { describe, expect, it } from 'vitest';
import { buttonClass } from './button.js';

describe('buttonClass', () => {
  it('carries the variant, the 44px target and any extra class', () => {
    const cls = buttonClass('secondary', 'default', 'flex-1');
    expect(cls).toContain('border-border-strong');
    expect(cls).toContain('min-h-11');
    expect(cls).toContain('flex-1');
  });
});
