import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openPlanFilePicker, isOpenFileShortcut, PLAN_FILE_ACCEPT } from '../filePicker';

function pickInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[data-testid="plan-file-input"]');
  if (!input) throw new Error('picker input missing');
  return input;
}

function choose(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
}

describe('openPlanFilePicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens a multi-file picker restricted to plan-like files', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    openPlanFilePicker(() => {});
    const input = pickInput();
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(PLAN_FILE_ACCEPT);
    for (const ext of ['.txt', '.xml', '.html', '.json', '.csv', 'text/*']) expect(input.accept).toContain(ext);
    click.mockRestore();
  });

  it('hands the chosen files over and can be reused for the same file', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const onFiles = vi.fn();
    const file = new File(['plan'], 'plan.txt', { type: 'text/plain' });

    openPlanFilePicker(onFiles);
    choose(pickInput(), [file]);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(pickInput().value).toBe('');

    openPlanFilePicker(onFiles);
    choose(pickInput(), [file]);
    expect(onFiles).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it('does nothing when the dialog is cancelled (no files)', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const onFiles = vi.fn();
    openPlanFilePicker(onFiles);
    choose(pickInput(), []);
    expect(onFiles).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe('isOpenFileShortcut', () => {
  function key(init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
    if (target) {
      document.body.appendChild(target);
      Object.defineProperty(event, 'target', { value: target });
    }
    return event;
  }

  it('matches Cmd/Ctrl+O', () => {
    expect(isOpenFileShortcut(key({ key: 'o', metaKey: true }))).toBe(true);
    expect(isOpenFileShortcut(key({ key: 'O', ctrlKey: true }))).toBe(true);
  });

  it('ignores a bare O, other modifiers and other keys', () => {
    expect(isOpenFileShortcut(key({ key: 'o' }))).toBe(false);
    expect(isOpenFileShortcut(key({ key: 'o', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isOpenFileShortcut(key({ key: 'p', metaKey: true }))).toBe(false);
  });

  it('does not fire while typing in a field', () => {
    expect(isOpenFileShortcut(key({ key: 'o', metaKey: true }, document.createElement('textarea')))).toBe(false);
    expect(isOpenFileShortcut(key({ key: 'o', ctrlKey: true }, document.createElement('input')))).toBe(false);
    expect(isOpenFileShortcut(key({ key: 'o', ctrlKey: true }, document.createElement('button')))).toBe(true);
  });
});
