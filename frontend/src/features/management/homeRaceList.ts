/**
 * Formatting shared by Home's race table row and its below-900px card
 * (#1137) — the same numbers and strings, laid out two different ways.
 * Pure, no React, the same split `raceSummary.ts` draws for the Roster
 * page's own header line.
 */

export interface RaceListFields {
    dateTime: string | null | undefined;
    location: string | null | undefined;
    registeredCount: number | null | undefined;
    checkedInCount: number | null | undefined;
}

export interface RaceListSummary {
    dateTimeLabel: string;
    locationLabel: string;
    registeredCount: number;
    checkedInCount: number;
}

export function raceListSummary(race: RaceListFields): RaceListSummary {
    return {
        dateTimeLabel: race.dateTime ? new Date(race.dateTime).toLocaleString() : '-',
        locationLabel: race.location || '-',
        registeredCount: race.registeredCount || 0,
        checkedInCount: race.checkedInCount || 0,
    };
}
