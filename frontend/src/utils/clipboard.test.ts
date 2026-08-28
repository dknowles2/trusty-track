import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error - restoring the jsdom default between tests
    delete navigator.clipboard;
  });

  it('uses the clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const result = await copyText('http://192.168.1.42:8000/race/1/vote');

    expect(writeText).toHaveBeenCalledWith('http://192.168.1.42:8000/race/1/vote');
    expect(result).toBe(true);
  });

  it('falls back to execCommand when the clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const result = await copyText('hello');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(result).toBe(true);
  });

  it('falls back to execCommand when the clipboard API refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const result = await copyText('hello');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(result).toBe(true);
  });

  it('reports failure rather than throwing when nothing works', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('removes the scratch textarea it creates', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);

    await copyText('hello');

    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
