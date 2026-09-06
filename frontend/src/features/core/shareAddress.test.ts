import { describe, expect, it } from 'vitest';
import { shareUrl, qrCodeSrc } from './shareAddress';

describe('shareUrl', () => {
  it('keeps the browser address when the origin is already not loopback', () => {
    // The default setup a QA sweep found broken: on a laptop plugged into
    // the venue router with its own address, the address the browser
    // already shows is fine and nothing should be substituted.
    const result = shareUrl('http://192.168.1.42:8000', '/race/1/vote', [
      '10.0.0.9',
    ]);

    expect(result).toEqual({ url: 'http://192.168.1.42:8000/race/1/vote', reachable: true });
  });

  it('substitutes a LAN address when the origin is localhost', () => {
    const result = shareUrl('http://localhost:8000', '/race/1/vote', ['192.168.1.42']);

    expect(result).toEqual({ url: 'http://192.168.1.42:8000/race/1/vote', reachable: true });
  });

  it('substitutes a LAN address when the origin is 127.0.0.1', () => {
    const result = shareUrl('http://127.0.0.1:8000', '/race/1/vote', ['192.168.1.42']);

    expect(result).toEqual({ url: 'http://192.168.1.42:8000/race/1/vote', reachable: true });
  });

  it('keeps the browser protocol and port when substituting', () => {
    const result = shareUrl('https://localhost:8443', '/race/1/vote', ['192.168.1.42']);

    expect(result.url).toBe('https://192.168.1.42:8443/race/1/vote');
  });

  it('drops the port entirely when the origin carries none', () => {
    const result = shareUrl('http://localhost', '/race/1/vote', ['192.168.1.42']);

    expect(result.url).toBe('http://192.168.1.42/race/1/vote');
  });

  it('picks the first address when the backend reports more than one', () => {
    const result = shareUrl('http://localhost:8000', '/race/1/vote', [
      '192.168.1.42',
      '10.0.0.9',
    ]);

    expect(result.url).toBe('http://192.168.1.42:8000/race/1/vote');
  });

  it('warns rather than substituting when no address was found', () => {
    // The failure the issue reported: showing localhost as if it worked.
    // Once nothing can be substituted, the page has to say so instead.
    const result = shareUrl('http://localhost:8000', '/race/1/vote', []);

    expect(result).toEqual({ url: 'http://localhost:8000/race/1/vote', reachable: false });
  });

  it('warns on an unparseable origin rather than throwing', () => {
    const result = shareUrl('not a url', '/race/1/vote', ['192.168.1.42']);

    expect(result.reachable).toBe(false);
  });

  // #723: the mDNS hostname outlasts a DHCP lease change, where a bare IP
  // does not, so it wins whenever the backend has one.
  it('prefers the mDNS hostname over a LAN address when both are available', () => {
    const result = shareUrl(
      'http://localhost:8000',
      '/race/1/vote',
      ['192.168.1.42'],
      'trustytrack.local',
    );

    expect(result).toEqual({ url: 'http://trustytrack.local:8000/race/1/vote', reachable: true });
  });

  it('uses the mDNS hostname even when no LAN address was found at all', () => {
    const result = shareUrl('http://localhost:8000', '/race/1/vote', [], 'trustytrack.local');

    expect(result).toEqual({ url: 'http://trustytrack.local:8000/race/1/vote', reachable: true });
  });

  it('reports whatever name registration actually won, not the plain one', () => {
    // A colliding LAN reports `trustytrack-2.local` — never the name that
    // was merely asked for (#723's own rule for `discovery.start()`).
    const result = shareUrl(
      'http://localhost:8000',
      '/race/1/vote',
      ['192.168.1.42'],
      'trustytrack-2.local',
    );

    expect(result.url).toBe('http://trustytrack-2.local:8000/race/1/vote');
  });

  it('falls back to a LAN address when no mDNS hostname is available', () => {
    const result = shareUrl('http://localhost:8000', '/race/1/vote', ['192.168.1.42'], null);

    expect(result.url).toBe('http://192.168.1.42:8000/race/1/vote');
  });

  it('does not substitute the mDNS hostname when the origin is already reachable', () => {
    // Same rule as a LAN address: nothing here overrides an address that
    // already works from off this machine.
    const result = shareUrl(
      'http://192.168.1.42:8000',
      '/race/1/vote',
      [],
      'trustytrack.local',
    );

    expect(result).toEqual({ url: 'http://192.168.1.42:8000/race/1/vote', reachable: true });
  });
});

describe('qrCodeSrc', () => {
  it('scopes the QR image to the race and carries the URL to encode', () => {
    expect(qrCodeSrc(1, 'http://192.168.1.42:8000/race/1/vote')).toBe(
      '/api/printables/vote-qr/1.png?url=http%3A%2F%2F192.168.1.42%3A8000%2Frace%2F1%2Fvote',
    );
  });
});
