import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIN_HEADER } from './pin';
import { verifyPin } from './verifyPin';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('asking the server what a candidate PIN is worth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the candidate PIN, never a stored one', async () => {
    // A raw request, not the urql client — which would attach whatever PIN
    // this device already holds instead of the one being tried.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ data: { initialConfig: { role: 'OPERATOR' } } }));

    await verifyPin('4321');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/graphql');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)[PIN_HEADER]).toBe('4321');
  });

  it('resolves to the role a right PIN carries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { initialConfig: { role: 'OPERATOR' } } }),
    );
    await expect(verifyPin('4321')).resolves.toBe('OPERATOR');
  });

  it('resolves to CHECKIN for the check-in PIN', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { initialConfig: { role: 'CHECKIN' } } }),
    );
    await expect(verifyPin('1111')).resolves.toBe('CHECKIN');
  });

  it('resolves to VIEWER for a wrong PIN, rather than throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { initialConfig: { role: 'VIEWER' } } }),
    );
    await expect(verifyPin('0000')).resolves.toBe('VIEWER');
  });

  it('throws when the server cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, 500));
    await expect(verifyPin('4321')).rejects.toThrow();
  });

  it('throws on a malformed response rather than resolving to something falsy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: {} }));
    await expect(verifyPin('4321')).rejects.toThrow();
  });
});
