// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useQuery } from 'urql';
import QRCodeDisplayView from './QRCodeDisplayView';

vi.mock('urql', async () => {
    const actual = await vi.importActual<typeof import('urql')>('urql');
    return { ...actual, useQuery: vi.fn() };
});

function mockNetworkAddresses(networkAddresses: string[]) {
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: { networkAddresses }, fetching: false, error: undefined },
        vi.fn(),
    ]);
}

function stubOrigin(origin: string) {
    vi.stubGlobal('location', { origin });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('QRCodeDisplayView (#614)', () => {
    it('says what it is, for the full-screen-view plumbing to hook onto', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="STANDINGS" />);

        expect(screen.getByTestId('qrcode-view')).toBeInTheDocument();
    });

    it('shows the derived headline for the standings target', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="STANDINGS" />);

        expect(screen.getByText(/live race results/i)).toBeInTheDocument();
    });

    it('shows the derived headline for the vote target', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="VOTE" />);

        expect(screen.getByText(/scan to vote/i)).toBeInTheDocument();
    });

    it('prefers the races own headline when it set one', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(
            <QRCodeDisplayView raceId={7} target="VOTE" headline="Scan for Best in Show!" />,
        );

        expect(screen.getByText('Scan for Best in Show!')).toBeInTheDocument();
        expect(screen.queryByText(/live race results/i)).toBeNull();
    });

    it('points the code at the observation page for the standings target', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="STANDINGS" />);

        expect(screen.getByText(/192\.168\.1\.42:8000\/race\/7\/observation/)).toBeInTheDocument();
        const image = screen.getByAltText(/qr code/i);
        expect(decodeURIComponent(image.getAttribute('src')!)).toContain(
            'http://192.168.1.42:8000/race/7/observation',
        );
    });

    it('points the code at the ballot for the vote target', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="VOTE" />);

        expect(screen.getByText(/192\.168\.1\.42:8000\/race\/7\/vote/)).toBeInTheDocument();
    });

    it('substitutes a LAN address for a localhost origin', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="STANDINGS" />);

        expect(screen.getByAltText(/qr code/i)).toBeInTheDocument();
    });

    it('warns instead of rendering a code when nothing could be substituted', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses([]);

        render(<QRCodeDisplayView raceId={7} target="STANDINGS" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.queryByAltText(/qr code/i)).toBeNull();
    });

    it('shows the venue wifi note when set', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(
            <QRCodeDisplayView
                raceId={7}
                target="STANDINGS"
                wifiNote="Connect to Pack 123 Guest Wi-Fi"
            />,
        );

        expect(screen.getByText('Connect to Pack 123 Guest Wi-Fi')).toBeInTheDocument();
    });

    it('shows no wifi note when the race has not set one', () => {
        stubOrigin('http://localhost:8000');
        mockNetworkAddresses(['192.168.1.42']);

        render(<QRCodeDisplayView raceId={7} target="STANDINGS" />);

        expect(screen.queryByText(/wi-fi/i)).toBeNull();
    });
});
