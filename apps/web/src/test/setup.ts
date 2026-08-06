import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// `globals` stays false in vite.config.ts (existing tests import
// describe/it/expect explicitly from vitest), so neither of these
// self-registers automatically the way they would under Jest/globals mode.
expect.extend(matchers);
afterEach(cleanup);
