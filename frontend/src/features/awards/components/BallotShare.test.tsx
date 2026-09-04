import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from 'urql';
import BallotShare from './BallotShare';
import * as clipboard from '../../../utils/clipboard';

vi.mock('urql', async () => {
  const actual = await vi.importActual<typeof import('urql')>('urql');
  return { ...actual, useQuery: vi.fn() };
});

vi.mock('../../../utils/clipboard', () => ({ copyText: vi.fn() }));

function mockNetworkAddresses(networkAddresses: string[] | undefined) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: networkAddresses ? { networkAddresses } : undefined, fetching: false, error: undefined },
    vi.fn(),
  ]);
}

function stubOrigin(origin: string) {
  vi.stubGlobal('location', { origin });
}

describe('BallotShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('substitutes a LAN address for a localhost origin', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<BallotShare raceId={1} />);

    expect(screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/vote/)).toBeInTheDocument();
  });

  it('keeps the browser address when it is already not loopback', () => {
    stubOrigin('http://192.168.1.42:8000');
    mockNetworkAddresses([]);

    render(<BallotShare raceId={1} />);

    expect(screen.getByText(/http:\/\/192\.168\.1\.42:8000\/race\/1\/vote/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns when nothing could be substituted for a localhost origin', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses([]);

    render(<BallotShare raceId={1} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not find/i);
  });

  it('shows no warning once a LAN address is found', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<BallotShare raceId={1} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a QR code pointing at the reachable address', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);

    render(<BallotShare raceId={1} />);

    const image = screen.getByAltText(/qr code/i);
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('/api/printables/vote-qr/1.png?url='),
    );
    expect(decodeURIComponent(image.getAttribute('src')!)).toContain(
      'http://192.168.1.42:8000/race/1/vote',
    );
  });

  it('renders no QR code when the address is not known to be reachable', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses([]);

    render(<BallotShare raceId={1} />);

    expect(screen.queryByAltText(/qr code/i)).toBeNull();
  });

  it('copies the shown address on click', async () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);
    vi.mocked(clipboard.copyText).mockResolvedValue(true);

    render(<BallotShare raceId={1} />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(clipboard.copyText).toHaveBeenCalledWith('http://192.168.1.42:8000/race/1/vote');
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument());
  });

  it('does not claim success when the copy failed', async () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);
    vi.mocked(clipboard.copyText).mockResolvedValue(false);

    render(<BallotShare raceId={1} />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => expect(clipboard.copyText).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /copied/i })).toBeNull();
  });

  it('treats a missing query result as no addresses rather than throwing', () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(undefined);

    expect(() => render(<BallotShare raceId={1} />)).not.toThrow();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('opens a fresh display window pointed at the QR code view (#614)', async () => {
    stubOrigin('http://localhost:8000');
    mockNetworkAddresses(['192.168.1.42']);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    render(<BallotShare raceId={1} />);
    await userEvent.click(screen.getByRole('button', { name: /project qr code/i }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(url).toMatch(/^\/race\/1\/observation\?displayId=.+&view=qrcode&qr_target=vote$/);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
  });
});
