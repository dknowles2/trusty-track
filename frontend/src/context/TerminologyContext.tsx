/**
 * The words a screen should use for "Den" and "Pack" (#496, stage 4).
 *
 * Both are configurable per `docs`/`domain/terminology.py` on the backend:
 * an organization sets an install-wide default, and a race may override it.
 * The server already layers those two — `Race.terminology` and
 * `InitialConfigStatus.terminology` are both *resolved*, never null — so
 * this context holds only the finished answer and never merges anything
 * itself. That mirrors why the live heat view lives on the server (#7):
 * two screens computing the same layering independently is how they'd end
 * up disagreeing.
 *
 * `App.tsx` seeds two layers of provider: one wrapping the whole app from
 * `initialConfig.terminology` (the organization's default, for Home, System
 * Settings and anything else with no race in view), and one per race route
 * — `RaceTerminologyGate` — that overrides it with `race.terminology` once
 * that query answers. A page under `/race/:raceId` never queries this
 * itself; it reads `useTerminology()`.
 *
 * Every value defaults to the built-in Scouting words, `DEFAULT_TERMINOLOGY`
 * below, mirrored from `backend/domain/terminology.py`'s constant of the
 * same name — which is also what an unconfigured provider (no query has
 * answered yet, or this render tree sits outside any provider at all, as in
 * a unit test) renders. That default is deliberately exact: it is what
 * keeps an unconfigured install reading precisely as it always has.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/** Mirrors the GraphQL `Terminology` type — the four resolved, never-null
 * words a query already returned. */
export interface Terminology {
    racingGroupSingular: string;
    racingGroupPlural: string;
    organizationSingular: string;
    organizationPlural: string;
}

/** The words every install showed before this setting existed, and what an
 * unconfigured install (or a race with no override) still shows today. */
// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_TERMINOLOGY: Terminology = {
    racingGroupSingular: 'Den',
    racingGroupPlural: 'Dens',
    organizationSingular: 'Pack',
    organizationPlural: 'Packs',
};

/** What `useTerminology()` hands back — the resolved words plus a lowercase
 * form of each, for the sentences that use one mid-clause ("your den's
 * time" rather than "your Den's time"). Lowercasing is done here, on read,
 * rather than stored as a second variant: the server only ever stores the
 * label. */
export interface TerminologyWords {
    group: string;
    groups: string;
    org: string;
    orgs: string;
    groupLower: string;
    groupsLower: string;
    orgLower: string;
    orgsLower: string;
}

const TerminologyContext = createContext<Terminology>(DEFAULT_TERMINOLOGY);

export function TerminologyProvider({
    value,
    children,
}: {
    /** Absent or not-yet-loaded means "keep whatever this tree already had"
     * — `RaceTerminologyGate` relies on this to avoid a flash of the
     * built-in words while its own query is still in flight. */
    value?: Terminology | null;
    children: ReactNode;
}) {
    const outer = useContext(TerminologyContext);
    return (
        <TerminologyContext.Provider value={value ?? outer}>
            {children}
        </TerminologyContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTerminology(): TerminologyWords {
    const t = useContext(TerminologyContext);
    return useMemo(
        () => ({
            group: t.racingGroupSingular,
            groups: t.racingGroupPlural,
            org: t.organizationSingular,
            orgs: t.organizationPlural,
            groupLower: t.racingGroupSingular.toLowerCase(),
            groupsLower: t.racingGroupPlural.toLowerCase(),
            orgLower: t.organizationSingular.toLowerCase(),
            orgsLower: t.organizationPlural.toLowerCase(),
        }),
        [t.racingGroupSingular, t.racingGroupPlural, t.organizationSingular, t.organizationPlural],
    );
}
