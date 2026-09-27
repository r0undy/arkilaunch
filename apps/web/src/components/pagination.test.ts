import { describe, expect, it } from 'vitest';
import { pageWindow } from './pagination.js';

describe('pageWindow', () => {
  it('keeps first, last and neighbours, gaps as null', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(4, 7)).toEqual([1, null, 3, 4, 5, null, 7]);
    expect(pageWindow(25, 50)).toEqual([1, null, 24, 25, 26, null, 50]);
    expect(pageWindow(2, 50)).toEqual([1, 2, 3, null, 50]);
  });
});
