import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// jest-dom only augments Jest's namespace; Vitest's Assertion needs the merge by hand.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- pure re-export merge, not a widening no-op
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- pure re-export merge, not a widening no-op
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
