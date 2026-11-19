import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedPlan } from '../../lib/types';
import { buildPlan } from '../../lib/__tests__/fixtures/buildPlan';

const ctx = vi.hoisted(() => ({
  parsedPlan: null as unknown,
  selectNode: vi.fn(),
  selectedNodeIds: [] as number[],
}));

vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({
    parsedPlan: ctx.parsedPlan,
    selectedNodeIds: ctx.selectedNodeIds,
    selectNode: ctx.selectNode,
    theme: 'light',
    palette: 'slate',
  }),
}));

import { ReplayView } from '../views/experimental/replay/ReplayView';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';

const LAYOUT_KEY = 'ora-explain-viz-replay-layout';

// SELECT ← SORT ORDER BY (spills) ← HASH JOIN (DIM build, FACT probe)
const PLAN: ParsedPlan = buildPlan({
  id: 0, op: 'SELECT STATEMENT', actualRows: 1000, starts: 1,
  kids: [{
    id: 1, op: 'SORT ORDER BY', rows: 1000, actualRows: 1000, starts: 1, tempUsed: 50 * 1024 * 1024, memoryUsed: 5 * 1024 * 1024,
    kids: [{
      id: 2, op: 'HASH JOIN', rows: 1000, actualRows: 1000, starts: 1,
      kids: [
        { id: 3, op: 'TABLE ACCESS FULL', objectName: 'DIM', rows: 50, actualRows: 50, starts: 1 },
        { id: 4, op: 'TABLE ACCESS FULL', objectName: 'FACT', rows: 1000, actualRows: 1000, starts: 1 },
      ],
    }],
  }],
});

const caption = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
const playButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Play"], button[aria-label="Pause"]')!;
const slider = () => document.querySelector<HTMLElement>('[role="slider"]')!;
const layoutGroup = () => document.querySelector<HTMLElement>('[aria-label="Replay layout"]')!;

beforeAll(() => {
  // jsdom has no canvas; the canvas layouts skip drawing without a context.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  ctx.parsedPlan = PLAN;
  ctx.selectedNodeIds = [];
  ctx.selectNode.mockReset();
  localStorage.removeItem(LAYOUT_KEY);
});
afterEach(cleanup);

describe('ReplayView', () => {
  it('starts on the tree layout, paused at the beginning', () => {
    render(<ReplayView />);
    expect(buttonByText('Tree', layoutGroup()).getAttribute('aria-pressed')).toBe('true');
    expect(caption()).toContain('Reading DIM');
    expect(caption()).toContain('Space to play');
    expect(playButton().getAttribute('aria-label')).toBe('Play');
    expect(slider().getAttribute('aria-valuenow')).toBe('0');
    expect(document.body.textContent).toContain('Approximate timing');
  });

  it('steps through the chapters with ] and [', () => {
    render(<ReplayView />);
    press(document.body, ']');
    expect(caption()).toContain('Hash table built (#2)');
    press(document.body, ']');
    expect(caption()).toContain('spilling to TEMP (#1)');
    press(document.body, '[');
    expect(caption()).toContain('Hash table built (#2)');
    press(document.body, '[');
    expect(caption()).toContain('Reading DIM');
  });

  it('toggles playback with Space, but leaves Space on a focused button alone', () => {
    render(<ReplayView />);
    press(document.body, ' ');
    expect(playButton().getAttribute('aria-label')).toBe('Pause');
    press(document.body, ' ');
    expect(playButton().getAttribute('aria-label')).toBe('Play');
    const event = press(buttonByText('Lanes', layoutGroup()), ' ');
    expect(event.defaultPrevented).toBe(false);
    expect(playButton().getAttribute('aria-label')).toBe('Play');
  });

  it('moves the playhead from the keyboard on the scrubber', () => {
    render(<ReplayView />);
    press(slider(), 'End');
    expect(caption()).toContain('Done');
    press(slider(), 'Home');
    expect(slider().getAttribute('aria-valuenow')).toBe('0');
  });

  it('switches layouts, keeps the playhead and remembers the choice', () => {
    render(<ReplayView />);
    press(document.body, ']');
    press(document.body, ']');
    click(buttonByText('Lanes', layoutGroup()));
    expect(localStorage.getItem(LAYOUT_KEY)).toBe('lanes');
    expect(caption()).toContain('spilling to TEMP (#1)');
    expect(document.body.textContent).toContain('Rows so far');
    cleanup();

    render(<ReplayView />);
    expect(buttonByText('Lanes', layoutGroup()).getAttribute('aria-pressed')).toBe('true');
  });

  it('selects an operation from its lane', () => {
    localStorage.setItem(LAYOUT_KEY, 'lanes');
    render(<ReplayView />);
    const row = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('FACT'))!;
    click(row);
    expect(ctx.selectNode).toHaveBeenCalledWith(4);
  });

  it('lists the chapters in the story layout and jumps to one on click', () => {
    localStorage.setItem(LAYOUT_KEY, 'story');
    render(<ReplayView />);
    const list = document.querySelector('ol[aria-label="Chapters"]')!;
    expect(list.querySelectorAll('li').length).toBeGreaterThanOrEqual(4);
    const spill = [...list.querySelectorAll('button')].find((b) => b.textContent?.includes('spilling to TEMP (#1)'))!;
    click(spill);
    const current = list.querySelector('[aria-current="step"]')!;
    expect(current.textContent).toContain('spilling to TEMP (#1)');
    expect(current.textContent).toContain('TEMP');
    expect(current.textContent).toContain('50.0 MB');
  });

  it('says so when there is nothing to replay', () => {
    ctx.parsedPlan = { ...PLAN, rootNode: null };
    render(<ReplayView />);
    expect(document.body.textContent).toContain('no operations to replay');
  });
});
