import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// `globals` is off, so neither self-registers.
expect.extend(matchers);
afterEach(cleanup);
