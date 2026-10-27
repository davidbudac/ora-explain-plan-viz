import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { renderPlanContext } from '../../components/ui/__tests__/planContext';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('openMetadataObject', () => {
  it('selects the object and switches to the Metadata tab', () => {
    const ctx = renderPlanContext();
    expect(ctx.current().metadataSelectedKey).toBeNull();
    act(() => ctx.current().openMetadataObject('HR.EMPLOYEES'));
    expect(ctx.current().metadataSelectedKey).toBe('HR.EMPLOYEES');
    expect(ctx.current().viewMode).toBe('metadata');
  });

  it('only selects, without changing the view, while the explorer is popped out', () => {
    const ctx = renderPlanContext();
    act(() => ctx.current().setMetadataPopoutOpen(true));
    const before = ctx.current().viewMode;
    act(() => ctx.current().openMetadataObject('HR.EMP_IDX'));
    expect(ctx.current().metadataSelectedKey).toBe('HR.EMP_IDX');
    expect(ctx.current().viewMode).toBe(before);
  });
});
