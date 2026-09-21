// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useSerialProxy } from '../../../context/SerialProxyContext';
import { SerialProxyConnector } from './SerialProxyConnector';

vi.mock('../../../context/SerialProxyContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../context/SerialProxyContext')>();
    return {
        ...actual,
        useSerialProxy: vi.fn(),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function mockProxy(over: Partial<ReturnType<typeof useSerialProxy>> = {}) {
    (useSerialProxy as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 'disconnected',
        errorMsg: null,
        activeTrackId: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        isSupported: true,
        ...over,
    });
}

describe('SerialProxyConnector, standalone (default, no `inline`)', () => {
    it('renders the column container and unmodified button classes', () => {
        mockProxy();
        const { container } = render(<SerialProxyConnector trackId={1} />);

        const wrapper = container.querySelector('.proxy-connector-container');
        expect(wrapper).not.toBeNull();
        expect(wrapper?.className).toBe('proxy-connector-container');

        const button = screen.getByRole('button', { name: /Connect Hardware Timer/ });
        expect(button.className).toBe('proxy-connect-btn');
        expect(button.className).not.toContain('--inline');
    });

    it('nests the error notice inside the column container, above the button', () => {
        mockProxy({ status: 'error', errorMsg: 'The timer connection failed.' });
        const { container } = render(<SerialProxyConnector trackId={1} />);

        const wrapper = container.querySelector('.proxy-connector-container');
        expect(wrapper).not.toBeNull();
        const error = wrapper!.querySelector('.proxy-connector-error');
        expect(error).not.toBeNull();
        expect(error?.className).not.toContain('--inline');
        // Error is a child of the column container, ahead of the button.
        expect(wrapper!.children[0]).toBe(error);
        expect(wrapper!.children[1]?.tagName).toBe('BUTTON');
    });

    it('renders the connected badge and the unsupported notice with unmodified classes', () => {
        mockProxy({ status: 'connected' });
        const { container: connectedContainer } = render(<SerialProxyConnector trackId={1} />);
        const badge = connectedContainer.querySelector('.proxy-connector-status.connected');
        expect(badge).not.toBeNull();
        expect(badge?.className).toBe('proxy-connector-status connected');
        cleanup();

        mockProxy({ isSupported: false });
        const { container: unsupportedContainer } = render(<SerialProxyConnector trackId={1} />);
        const notice = unsupportedContainer.querySelector('.proxy-connector-unsupported');
        expect(notice).not.toBeNull();
        expect(notice?.className).toBe('proxy-connector-unsupported');
    });
});

describe('SerialProxyConnector, `inline` (Timer check\'s action row, #1299)', () => {
    it('renders the button with no wrapping container, carrying the inline modifier', () => {
        mockProxy();
        const { container } = render(<SerialProxyConnector trackId={1} inline />);

        expect(container.querySelector('.proxy-connector-container')).toBeNull();

        const button = screen.getByRole('button', { name: /Connect Hardware Timer/ });
        expect(button.className).toBe('proxy-connect-btn proxy-connect-btn--inline');
    });

    it('renders the error notice as a sibling of the button, not nested inside a column', () => {
        mockProxy({ status: 'error', errorMsg: 'The timer connection failed.' });
        const { container } = render(<SerialProxyConnector trackId={1} inline />);

        expect(container.querySelector('.proxy-connector-container')).toBeNull();
        const error = container.querySelector('.proxy-connector-error');
        expect(error).not.toBeNull();
        expect(error?.className).toBe('proxy-connector-error proxy-connector-error--inline');
        expect(screen.getByText('The timer connection failed.')).toBeInTheDocument();
    });

    it('carries the inline modifier on the connected badge too — a real event spends most of its time here', () => {
        mockProxy({ status: 'connected' });
        const { container } = render(<SerialProxyConnector trackId={1} inline />);

        const badge = container.querySelector('.proxy-connector-status.connected');
        expect(badge).not.toBeNull();
        expect(badge?.className).toBe('proxy-connector-status connected proxy-connector-status--inline');
        expect(screen.getByText('Hardware Timer Proxy Active')).toBeInTheDocument();
    });

    it('carries the inline modifier on the unsupported notice too', () => {
        mockProxy({ isSupported: false });
        const { container } = render(<SerialProxyConnector trackId={1} inline />);

        const notice = container.querySelector('.proxy-connector-unsupported');
        expect(notice).not.toBeNull();
        expect(notice?.className).toBe('proxy-connector-unsupported proxy-connector-unsupported--inline');
    });
});
