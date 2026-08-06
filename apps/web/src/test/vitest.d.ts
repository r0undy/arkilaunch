import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// @testing-library/jest-dom's own types only augment Jest's namespace
// (types/jest.d.ts); Vitest's `expect` needs its `Assertion` interface
// augmented separately. There is no bundled Vitest-specific export in this
// jest-dom version, so this file does that merge by hand.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- pure re-export merge, not a widening no-op
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- pure re-export merge, not a widening no-op
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
