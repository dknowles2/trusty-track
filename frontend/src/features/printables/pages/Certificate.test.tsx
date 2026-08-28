// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { print } from 'graphql';
import { useQuery } from 'urql';
import { GET_CERTIFICATES } from '../graphql/queries';
import Certificate from './Certificate';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const RACE = {
    id: 1,
    name: 'Pack 42 Derby',
    dateTime: '2026-03-14T09:30:00',
    location: 'St Anne’s Hall',
    awards: [
        {
            id: 10,
            name: 'Best Paint',
            kind: 'SPECIAL',
            sortOrder: 0,
            artworkKey: 'paintbrush',
            recipient: { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
        },
        {
            id: 11,
            name: "Judges' Choice",
            kind: 'SPECIAL',
            sortOrder: 1,
            artworkKey: null,
            recipient: null,
        },
        {
            id: 12,
            name: 'Fastest Car',
            kind: 'SPEED',
            sortOrder: 2,
            artworkKey: 'trophy',
            recipient: { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
        },
    ],
};

function mockRace(race: unknown = RACE) {
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: race === null ? { race: null } : { race }, fetching: false, error: undefined },
        vi.fn(),
    ]);
}

function open() {
    return render(
        <MemoryRouter initialEntries={['/race/1/print/certificates']}>
            <Routes>
                <Route path="/race/:raceId/print/certificates" element={<Certificate />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('the certificate page', () => {
    it('asks for every field it renders', () => {
        const document = print(GET_CERTIFICATES);
        for (const field of ['name', 'kind', 'sortOrder', 'artworkKey', 'recipient']) {
            expect(document).toContain(field);
        }
    });

    it('prints one certificate per award', () => {
        mockRace();
        open();
        expect(screen.getByText('Best Paint')).toBeInTheDocument();
        expect(screen.getByText("Judges' Choice")).toBeInTheDocument();
        expect(screen.getByText('Fastest Car')).toBeInTheDocument();
    });

    it('fills in the recipient when there is one', () => {
        mockRace();
        open();
        expect(screen.getByText('Ada Lovelace (#42)')).toBeInTheDocument();
        expect(screen.getByText('Grace Hopper (#7)')).toBeInTheDocument();
    });

    it('leaves an undecided award blank rather than skipping it', () => {
        mockRace();
        open();
        const undecided = screen.getByText("Judges' Choice").closest('.certificate')!;
        expect(undecided.querySelector('.certificate-recipient-blank')).toBeInTheDocument();
    });

    it('draws artwork when the award has a key, and none when it does not', () => {
        mockRace();
        open();
        const withArt = screen.getByText('Best Paint').closest('.certificate')!;
        expect(withArt.querySelector('svg[role="img"]')).toBeInTheDocument();

        const plain = screen.getByText("Judges' Choice").closest('.certificate')!;
        expect(plain.querySelector('svg[role="img"]')).toBeNull();
    });

    it('has something to say when a race has no awards', () => {
        mockRace({ ...RACE, awards: [] });
        open();
        expect(screen.getByText(/no awards to print yet/i)).toBeInTheDocument();
    });

    it('reports the race not found rather than crashing', () => {
        mockRace(null);
        open();
        expect(screen.getByText(/race not found/i)).toBeInTheDocument();
    });
});
