import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from 'urql';
import ConnectDisplayAddress from './ConnectDisplayAddress';
import * as clipboard from '../../../utils/clipboard';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return { ...actual, useQuery: vi.fn() };
});

vi.mock('../../../utils/clipboard', () => ({ copyText: vi.fn() }));

function mockNetworkAddresses(
  networkAddresses: string[] | undefined,
  mdnsHostname: string | null = null,
) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    {
      data: networkAddresses ? { networkAddresses, mdnsHostname } : undefined,
      fetching: false,
      error: undefined,
    },
    vi.fn(),
  ]);
}

function stubOrigin(origin: string) {
  vi.stubGlobal('location', { origin });
}

describe('ConnectDisplayAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('substitutes a LAN address for a localhost origin', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<ConnectDisplayAddress raceId={1} />);

    expect(
      screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/observation/),
    ).toBeInTheDocument();
  });

  it('prefers the mDNS hostname over a LAN address when the backend has one (#723)', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42'], 'trustytrack.local');

    render(<ConnectDisplayAddress raceId={1} />);

    expect(
      screen.getByText(/http:\/\/trustytrack\.local:8000\/race\/1\/observation/),
    ).toBeInTheDocument();
  });

  it('keeps the browser address when it is already not loopback', () => {
    stubOrigin('http://192.168.1.42:8000');
    mockNetworkAddresses([]);

    render(<ConnectDisplayAddress raceId={1} />);

    expect(
      screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/observation/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns when nothing could be substituted for a localhost origin', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses([]);

    render(<ConnectDisplayAddress raceId={1} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not find/i);
  });

  it('shows no warning once an address is found', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<ConnectDisplayAddress raceId={1} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a QR code pointing at the reachable address', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<ConnectDisplayAddress raceId={1} />);

    const image = screen.getByAltText(/qr code/i);
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('/api/printables/vote-qr/1.png?url='),
    );
    expect(decodeURIComponent(image.getAttribute('src')!)).toContain(
      'http://192.168.1.42:8000/race/1/observation',
    );
  });

  it('renders no QR code when the address is not known to be reachable', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses([]);

    render(<ConnectDisplayAddress raceId={1} />);

    expect(screen.queryByAltText(/qr code/i)).toBeNull();
  });

  it('hides the QR code once it fails to load, leaving the printed address (#944)', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<ConnectDisplayAddress raceId={1} />);

    const image = screen.getByAltText(/qr code/i);
    act(() => {
      image.dispatchEvent(new Event('error'));
    });

    expect(screen.queryByAltText(/qr code/i)).toBeNull();
    expect(
      screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/observation/),
    ).toBeInTheDocument();
  });

  // #1182: `qrTargetPath`'s `STANDINGS` target carries `?spectator=1` when
  // passed `{ spectator: true }`, for the audience-facing QR code
  // (`QRCodeDisplayView.tsx`). This component's own address is the
  // opposite case — an operator connecting a genuinely new wall display or
  // check-in tablet — and has to pass `{ spectator: false }` explicitly
  // (the argument is required, not defaulted), or scanning/typing it would
  // silently stop that screen from ever registering.
  it('does not carry the spectator flag — this address is for connecting a real display', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<ConnectDisplayAddress raceId={1} />);

    expect(screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/observation$/)).toBeInTheDocument();
    const image = screen.getByAltText(/qr code/i);
    expect(decodeURIComponent(image.getAttribute('src')!)).not.toContain('spectator');
  });

  it('copies the shown address on click', async () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);
    vi.mocked(clipboard.copyText).mockResolvedValue(true);

    render(<ConnectDisplayAddress raceId={1} />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(clipboard.copyText).toHaveBeenCalledWith('http://192.168.1.42:8000/race/1/observation');
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument());
  });

  it('does not claim success when the copy failed', async () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);
    vi.mocked(clipboard.copyText).mockResolvedValue(false);

    render(<ConnectDisplayAddress raceId={1} />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => expect(clipboard.copyText).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /copied/i })).toBeNull();
  });

  it('treats a missing query result as no addresses rather than throwing', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(undefined);

    expect(() => render(<ConnectDisplayAddress raceId={1} />)).not.toThrow();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // #1254: `path` lets a second caller (the "Connect a camera" block) point
  // this same address/Copy/QR machinery somewhere other than the Live page.
  describe('the path prop (#1254)', () => {
    it('defaults to this races own Live page, unchanged', () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);

      render(<ConnectDisplayAddress raceId={1} />);

      expect(
        screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/observation$/),
      ).toBeInTheDocument();
    });

    it('drives the shown address when supplied', () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);

      render(<ConnectDisplayAddress raceId={1} path="/race/1/camera?displayId=abc&trackId=9" />);

      expect(
        screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/camera\?displayId=abc&trackId=9/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/\/observation/)).toBeNull();
    });

    it('drives the Copy button', async () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);
      vi.mocked(clipboard.copyText).mockResolvedValue(true);

      render(<ConnectDisplayAddress raceId={1} path="/race/1/camera?displayId=abc" />);
      await userEvent.click(screen.getByRole('button', { name: /copy/i }));

      expect(clipboard.copyText).toHaveBeenCalledWith(
        'http://192.168.1.42:8000/race/1/camera?displayId=abc',
      );
    });

    it('drives the QR code src', () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);

      render(<ConnectDisplayAddress raceId={1} path="/race/1/camera?displayId=abc" />);

      const image = screen.getByAltText(/qr code/i);
      expect(decodeURIComponent(image.getAttribute('src')!)).toContain(
        'http://192.168.1.42:8000/race/1/camera?displayId=abc',
      );
    });
  });

  describe('heading, caption and testId (#1254)', () => {
    it('renders no heading or caption by default', () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);

      render(<ConnectDisplayAddress raceId={1} />);

      expect(screen.queryByRole('heading')).toBeNull();
    });

    it('renders a supplied heading and caption', () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);

      render(
        <ConnectDisplayAddress
          raceId={1}
          heading="Connect a camera"
          caption="For the finish line — scan on the phone that will film it."
        />,
      );

      expect(screen.getByRole('heading', { name: 'Connect a camera' })).toBeInTheDocument();
      expect(
        screen.getByText('For the finish line — scan on the phone that will film it.'),
      ).toBeInTheDocument();
    });

    it('defaults the testId to connect-screen-address, and a caller may override it', () => {
      stubOrigin('http://localhost:8000');
      mockNetworkAddresses(['192.168.1.42']);

      const { rerender } = render(<ConnectDisplayAddress raceId={1} />);
      expect(screen.getByTestId('connect-screen-address')).toBeInTheDocument();

      rerender(<ConnectDisplayAddress raceId={1} testId="connect-camera-address" />);
      expect(screen.getByTestId('connect-camera-address')).toBeInTheDocument();
      expect(screen.queryByTestId('connect-screen-address')).toBeNull();
    });
  });
});
