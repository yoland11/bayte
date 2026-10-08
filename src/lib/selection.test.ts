import { describe, expect, it } from 'vitest';
import { setVisibleSelection, toggleSelection } from './selection';

describe('bulk selection', () => {
  it('toggles one selected transaction without mutating the previous selection', () => {
    const selected = ['tx-1'];
    expect(toggleSelection(selected, 'tx-2')).toEqual(['tx-1', 'tx-2']);
    expect(toggleSelection(selected, 'tx-1')).toEqual([]);
    expect(selected).toEqual(['tx-1']);
  });

  it('selects or clears only the visible transactions', () => {
    expect(setVisibleSelection(['hidden'], ['one', 'two'], true)).toEqual(['hidden', 'one', 'two']);
    expect(setVisibleSelection(['hidden', 'one', 'two'], ['one', 'two'], false)).toEqual(['hidden']);
  });
});
