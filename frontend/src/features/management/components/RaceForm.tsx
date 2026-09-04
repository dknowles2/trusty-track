import React, { useState, useMemo } from 'react';
import { useQuery } from 'urql';

import { DEFAULT_LIMIT_OZ, formatOunces } from '../weightCheck';
import { DEFAULT_TERMINOLOGY, VEHICLE_ARTWORK_OPTIONS } from '../../settings/terminologyDefaults';
import { useTerminology } from '../../../context/TerminologyContext';
import { SHARED, TIEBREAKER_OPTIONS, tiebreakerWontFire } from '../../stats/tiebreakText';
import { SCORING_STRATEGY_OPTIONS } from '../../stats/scoringStrategyText';
import { NAME_DISPLAY_OPTIONS } from '../../core/displayName';
import { GET_TRACKS } from '../../core/graphql/queries';
import SettingsNav from '../../settings/components/SettingsNav';
import {
    firstProblem,
    MAX_CHAMPIONSHIP_TROPHIES,
    MIN_CHAMPIONSHIP_TROPHIES,
    RACE_SECTIONS,
    sectionsFor,
    type RaceSectionId,
} from '../raceSettingsSections';

export interface RaceFormData {
    name: string;
    date_time: string;
    location: string;
    organization_id?: number;
    // Optional because a race need not name a track, and because the form
    // itself supplies one when it does not. Declaring it required meant a
    // missing value had to be smuggled through as `undefined` anyway, which is
    // how it reached `tracks[0]` unnoticed.
    track_id?: number;
    scoring_strategy: string;
    /** How a tie at a cut — a championship slot, an award's place — is
     * settled (#540). `SHARED` is the default and is a no-op: it is what
     * every race already did before this setting existed. */
    tiebreaker: string;
    /** How many of each racer's worst counted results to drop before
     * scoring (#547 stage 2) — a modifier over `scoring_strategy`, not a
     * fifth strategy. `0` is the off state, and there is no separate clear
     * flag: sending `0` back is exactly how an operator turns it off, same
     * shape `master_running_order`'s `false` already uses. */
    drop_worst_runs: number;
    car_numbering_strategy: string;
    global_start_number: number;
    championship_trophies: number;
    /** The pack's weight limit in ounces, or null for no check (#205). */
    weight_limit_oz?: number | null;
    /**
     * One interleaved running order across racing groups, instead of a
     * block per group (#549 stage 4). Off by default — running one group
     * at a time is how many events are deliberately structured.
     */
    master_running_order: boolean;
    /**
     * Once a championship round is decided, its winner(s) stop counting
     * toward the standings of the round they qualified from (#548) — the
     * Grand Finals pack champion no longer also holding their own den's
     * trophy. Off by default, and update-only like `master_running_order`
     * above: a race being created has no championship round yet to decide.
     */
    exclude_round_winners_from_qualifying_standings: boolean;
    /**
     * At most one trophy per racer (#615) — a racer who already holds an
     * award is skipped when resolving a later one, so a den speed trophy
     * rolls down to the next fastest car once its own winner has already
     * taken the pack championship. Off by default, and update-only like
     * `master_running_order` above: a race being created has no awards yet
     * to roll down between.
     */
    one_trophy_per_racer: boolean;
    /**
     * A per-race terminology override, null where this race inherits the
     * organization's word (#496 stage 3; #551 adds the vehicle pair and its
     * artwork). All seven travel together — the checkbox below is on when
     * any is non-null, and turning it off clears all seven rather than
     * leaving a partial override behind.
     */
    racing_group_singular?: string | null;
    racing_group_plural?: string | null;
    organization_singular?: string | null;
    organization_plural?: string | null;
    vehicle_singular?: string | null;
    vehicle_plural?: string | null;
    /** A per-race override of the vehicle artwork (#551, stage 4) — travels
     * with the six fields above rather than as a seventh independent
     * checkbox: an operator turning on custom terminology for a Space Derby
     * wants the rocket picture at the same moment, not a second toggle to
     * remember. */
    vehicle_artwork_key?: string | null;
    /**
     * A per-race override of how much of a racer's name a public screen may
     * show (#552), null where this race inherits the organization's
     * setting. Unlike the terminology fields above, `'FULL'` is itself a
     * real value here (not the inherit state), so the checkbox below is on
     * exactly when this is non-null, the same "inherited vs. set to the
     * same word" distinction the terminology override makes.
     */
    name_display?: string | null;
    /**
     * Locked against further edits (#585) — an event that has concluded,
     * guarded against an accidental change rather than a person with
     * something to hide. Update-only, the same reason `master_running_order`
     * is: a race being created has nothing yet to lock.
     */
    is_locked?: boolean;
}


interface RaceFormProps {
    initialData?: Partial<RaceFormData>;
    onSubmit: (data: RaceFormData) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
    submitLabel?: string;
    /**
     * Whether this is editing an existing race rather than creating one.
     * Two things hang off it. The update-only controls — the lock, the
     * running order, the two trophy rules, the terminology and name-display
     * overrides — exist only on `updateRace`, so a race being created has
     * nothing yet to submit them into. And the form is *sectioned* only
     * while editing (#587): see `sectionsFor` for why creating a race is
     * the wizard case and gets every field on one page.
     */
    isEditing?: boolean;
}

/**
 * A section's own heading.
 *
 * Sectioned, it is the title of the one section on screen, with the blurb
 * under it saying what the section is for. Flat (the create form), it is a
 * divider between groups of fields — the same words, so the create form
 * teaches the vocabulary the edit form is later navigated by — with no
 * blurb, since a first-time operator reading top to bottom is already
 * looking at what it would describe.
 */
function GroupHeading({ id, sectioned }: { id: RaceSectionId; sectioned: boolean }) {
    const meta = RACE_SECTIONS.find(s => s.id === id);
    if (!meta) return null;
    if (sectioned) {
        return (
            <>
                <h3 id={`race-section-${id}`} style={{ marginTop: 0, marginBottom: '0.25rem' }}>{meta.label}</h3>
                <p style={{ color: 'var(--text-muted-color)', fontSize: '0.9rem', marginTop: 0, marginBottom: '1.25rem' }}>
                    {meta.blurb}
                </p>
            </>
        );
    }
    return (
        <h3
            id={`race-section-${id}`}
            style={{
                fontSize: '1rem',
                margin: id === 'event' ? '0 0 0.75rem' : '1.25rem 0 0.75rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid var(--border-color)',
            }}
        >
            {meta.label}
        </h3>
    );
}

export default function RaceForm({ initialData, onSubmit, onCancel, onDelete, submitLabel = 'Save', isEditing = false }: RaceFormProps) {
    const { group, groupLower, groupsLower, vehicle, vehicleLower, vehiclesLower } = useTerminology();
    const [formData, setFormData] = useState<RaceFormData>({
        name: '',
        date_time: '',
        location: '',
        organization_id: 1, // Default
        track_id: 0,
        scoring_strategy: 'TIMED',
        tiebreaker: SHARED,
        drop_worst_runs: 0,
        car_numbering_strategy: 'GLOBAL',
        global_start_number: 1,
        championship_trophies: 3,
        // New races are offered the near-universal pack rule; an existing race
        // keeps whatever it has, including nothing. The column has no server
        // default on purpose — see the model.
        weight_limit_oz: DEFAULT_LIMIT_OZ,
        master_running_order: false,
        exclude_round_winners_from_qualifying_standings: false,
        one_trophy_per_racer: false,
        is_locked: false,
        ...initialData
    });
    const [loading, setLoading] = useState(false);
    const [tracksResult] = useQuery({ query: GET_TRACKS });
    const tracks = useMemo(() => tracksResult.data?.tracks || [], [tracksResult.data?.tracks]);
    const fetchingTracks = tracksResult.fetching;

    // Sectioned while editing, flat while creating — `sectionsFor` says why.
    // Event first: the lock lives there, and an event that has concluded is
    // the reason an operator opens this form again.
    const navSections = sectionsFor(isEditing);
    const sectioned = navSections.length > 0;
    const [section, setSection] = useState<RaceSectionId>('event');
    /** On the create form every section is on screen; otherwise only the chosen one. */
    const shows = (id: RaceSectionId) => !sectioned || section === id;
    // The first thing wrong with the whole form, wherever it is — see
    // `handleSubmit`. Cleared on the next attempt, not on every keystroke.
    const [problem, setProblem] = useState<string | null>(null);

    // The track defaults to the first one, derived rather than written back
    // into state by an effect. Nothing needs storing: until the operator picks
    // a track there is no choice to remember, and a effect that patched state
    // after the query resolved cost a second render to say the same thing.
    const trackId = formData.track_id || tracks[0]?.id || 0;

    // A race must name a track, and until this query answers there is nothing
    // to name. The form used to be submittable in that window: `trackId` was 0,
    // the insert failed the foreign key on `races.track_id`, and the operator
    // was told only "Failed to create race". Rare by hand and reliable on a
    // slow machine at a venue, which is what this app runs on.
    //
    // Nought is also what an install with no tracks at all gives — deleting the
    // last track is allowed while no race uses it — so the same test covers
    // both, and the field below says which of the two it is.
    const hasTrack = trackId !== 0;

    // Which tiebreaker methods are worth offering depends on this track's
    // timer, not just the scoring strategy (#540) — `tiebreakerWontFire`
    // reads both.
    const trackTimerType: string | null | undefined = tracks.find(
        (track: { id: number; timerType?: string | null }) => track.id === trackId,
    )?.timerType;

    const handleChange = (field: keyof RaceFormData, value: string | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // The submit button is disabled without a track, but a form can still
        // be submitted by pressing Enter in a text field, and browsers differ
        // on whether a disabled default button stops that.
        if (!hasTrack) return;
        const name = formData.name.trim();
        // The browser's own validation only covers the fields that are on
        // screen, and with one section showing at a time most of them are
        // not. So the whole form is checked here, and a failure takes the
        // operator to the section holding it rather than reporting a problem
        // they cannot see. Same shape as `SystemSettings.tsx`, for the same
        // reason.
        const found = firstProblem({ ...formData, name });
        if (found) {
            setProblem(found.message);
            if (sectioned) setSection(found.section);
            return;
        }
        setProblem(null);
        setLoading(true);
        try {
            await onSubmit({
                ...formData,
                track_id: trackId,
                name,
            });
        } finally {
            setLoading(false);
        }
    };

    // Layout only — the field's shape (padding, border, radius) is the
    // shared `.form-control` class (#439); this form is the one of the five
    // that stacks its fields with margin rather than a flex `gap`.
    const inputStyle = {
        marginBottom: '1rem',
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.9rem',
        marginBottom: '0.5rem',
        color: 'var(--text-strong-muted-color)',
        fontWeight: 'bold'
    };

    const helpStyle = {
        fontSize: '0.8rem',
        color: 'var(--text-muted-color)',
        marginTop: '-0.5rem',
        marginBottom: '1rem',
    };

    const checkboxLabelStyle = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' };

    const fieldsetStyle = { border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' };
    const legendStyle = { fontSize: '0.9rem', padding: '0 0.4rem' };
    const optionDescriptionStyle = { color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem', marginLeft: '1.4rem' };

    return (
        <form onSubmit={handleSubmit}>
            <div className={sectioned ? 'settings-layout race-form-layout' : undefined}>
                {sectioned && (
                    <SettingsNav
                        sections={navSections}
                        current={section}
                        onSelect={setSection}
                        label="Race settings sections"
                        testIdPrefix="race-settings-nav"
                    />
                )}

                <div className={sectioned ? 'settings-section' : undefined}>
                    {problem && (
                        <p
                            role="alert"
                            data-testid="race-form-problem"
                            style={{
                                color: 'var(--error)',
                                border: '1px solid var(--error)',
                                borderRadius: '8px',
                                padding: '0.5rem 0.75rem',
                                margin: '0 0 1rem',
                                fontSize: '0.9rem',
                            }}
                        >
                            {problem}
                        </p>
                    )}

                    {/* ---- Event: what it is called, when, where, which track ---- */}
                    {shows('event') && (
                        <section aria-labelledby="race-section-event" data-testid="race-section-event">
                            <GroupHeading id="event" sectioned={sectioned} />

                            {/* The lock (#585), prominent and first — an event that has
                                concluded is the reason an operator opens this form again, so
                                the control it is here for should not be buried under nine
                                others. Update-only, the same reason `master_running_order`
                                and the terminology override are: a race being created
                                has nothing yet to lock. */}
                            {isEditing && (
                                <div
                                    style={{
                                        border: `1px solid ${formData.is_locked ? 'var(--warning-strong-border-color)' : 'var(--border-color)'}`,
                                        borderRadius: '8px',
                                        padding: '0.75rem 1rem',
                                        marginBottom: '1rem',
                                        background: formData.is_locked ? 'var(--warning-bg-color)' : 'transparent',
                                    }}
                                >
                                    <label style={{ ...checkboxLabelStyle, marginBottom: '0.4rem', fontWeight: 'bold' }}>
                                        <input
                                            type="checkbox"
                                            id="race-is-locked"
                                            checked={formData.is_locked ?? false}
                                            onChange={e => setFormData(prev => ({ ...prev, is_locked: e.target.checked }))}
                                        />
                                        <span>{formData.is_locked ? 'Unlock race' : 'Lock race'}</span>
                                    </label>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', margin: 0 }}>
                                        Once an event has concluded, locking it guards against an accidental edit — a
                                        stray tap on a shared machine, not a step you have to remember to undo. While
                                        locked, scheduling, results, racer registrations and awards cannot be changed;
                                        the race stays fully readable, and can still be deleted.
                                    </p>
                                </div>
                            )}

                            <div>
                                <label style={labelStyle} htmlFor="race-name">Event Name</label>
                                <input
                                    id="race-name"
                                    type="text"
                                    value={formData.name}
                                    onChange={e => handleChange('name', e.target.value)}
                                    placeholder="e.g. 2024 Pinewood Derby"
                                    required
                                    className="form-control"
                                    style={inputStyle}
                                />
                            </div>
                            <div>
                                <label style={labelStyle} htmlFor="race-date-time">Date & Time</label>
                                <input
                                    id="race-date-time"
                                    type="datetime-local"
                                    value={formData.date_time}
                                    onChange={e => handleChange('date_time', e.target.value)}
                                    className="form-control"
                                    style={inputStyle}
                                />
                            </div>
                            <div>
                                <label style={labelStyle} htmlFor="race-location">Location</label>
                                <input
                                    id="race-location"
                                    type="text"
                                    value={formData.location}
                                    onChange={e => handleChange('location', e.target.value)}
                                    placeholder="e.g. School Gym"
                                    className="form-control"
                                    style={inputStyle}
                                />
                            </div>

                            {/* Which track — an event fact, beside the name and date,
                                rather than filed under timers: the track's own lanes,
                                timer and records are System Settings' business, and
                                this only says which one the race runs on. */}
                            <div>
                                <label style={labelStyle} htmlFor="race-track">Track / Timer</label>
                                {fetchingTracks ? (
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>Loading tracks...</p>
                                ) : !hasTrack ? (
                                    <p data-testid="no-tracks" style={{ fontSize: '0.9rem', color: 'var(--danger-strong-color)' }}>
                                        You have no tracks yet. Add one in System Settings, then come back
                                        and create your race.
                                    </p>
                                ) : (
                                <select
                                    id="race-track"
                                    value={trackId}
                                    onChange={e => handleChange('track_id', parseInt(e.target.value))}
                                    className="form-control"
                                    style={inputStyle}
                                    required
                                >
                                    {Array.isArray(tracks) && tracks.map(track => (
                                        <option key={track.id} value={track.id}>{track.name}</option>
                                    ))}
                                </select>
                                )}
                                <p style={helpStyle}>
                                    The track&apos;s lanes, timer and records are set up in System Settings — a
                                    track is hardware in the room, shared by every race run on it.
                                </p>
                            </div>

                            {/* The master running order (#549 stage 4): one interleaved
                                sequence across racing groups instead of a block per group,
                                so the track need not idle while the next group's cars are
                                staged. Off by default — applying it is a separate step on
                                the Schedule screen, not this checkbox by itself. The
                                description is always visible (#304), not only revealed once
                                checked. Gated on `isEditing` for the same reason the
                                terminology override is: `updateRace` is the only
                                mutation that accepts this field, so there is nothing to
                                submit while creating (`buildCreateRaceInput` does not send
                                it — see that file). Under the track, because it is about
                                how the event runs on that track. */}
                            {isEditing && (
                                <div>
                                    <label style={checkboxLabelStyle}>
                                        <input
                                            type="checkbox"
                                            id="race-master-running-order"
                                            checked={formData.master_running_order}
                                            onChange={e => setFormData(prev => ({ ...prev, master_running_order: e.target.checked }))}
                                        />
                                        <span>Interleave heats across every {groupLower}</span>
                                    </label>
                                    <p style={helpStyle}>
                                        Runs one {groupLower}&apos;s heat, then the next {groupLower}&apos;s, instead of every
                                        {' '}{groupLower} running its whole round back to back — so the track need not sit
                                        empty between {groupsLower}. Apply it from the Schedule screen once the rounds are
                                        set up.
                                    </p>
                                </div>
                            )}
                        </section>
                    )}

                    {/* ---- Scoring: how the standings are worked out, and who wins ---- */}
                    {shows('scoring') && (
                        <section aria-labelledby="race-section-scoring" data-testid="race-section-scoring">
                            <GroupHeading id="scoring" sectioned={sectioned} />

                            {/* Scoring (#547 stage 3): four strategies, each with its
                                one-line description always visible (#304), not only the one
                                currently picked — the same rule and the same fieldset shape
                                Ties (#540) uses just below. */}
                            <fieldset style={fieldsetStyle}>
                                <legend style={legendStyle}>Scoring</legend>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {SCORING_STRATEGY_OPTIONS.map(option => (
                                        <label key={option.value} style={{ display: 'block', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="race-scoring"
                                                checked={formData.scoring_strategy === option.value}
                                                onChange={() => handleChange('scoring_strategy', option.value)}
                                            />{' '}
                                            {option.label}
                                            <small style={optionDescriptionStyle}>
                                                {option.description}
                                            </small>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>

                            {/* Drop the worst run(s) (#547 stage 2/3) — a modifier over
                                whichever strategy is chosen above, not a strategy of its
                                own, so it sits beside Scoring rather than inside it. `0`
                                is off. It only ever fires when every racer who has
                                raced has the same number of runs, with at least one more
                                than the number dropped — otherwise nothing is dropped,
                                and the standings say so (`dropWorstNotice`). */}
                            <div>
                                <label style={labelStyle} htmlFor="race-drop-worst-runs">Drop worst run(s)</label>
                                <input
                                    id="race-drop-worst-runs"
                                    type="number"
                                    value={formData.drop_worst_runs}
                                    onChange={e =>
                                        handleChange('drop_worst_runs', Math.max(0, parseInt(e.target.value) || 0))
                                    }
                                    min="0"
                                    className="form-control"
                                    style={inputStyle}
                                />
                                <p style={helpStyle}>
                                    {formData.drop_worst_runs > 0
                                        ? `Each racer's worst ${formData.drop_worst_runs} counted result${formData.drop_worst_runs === 1 ? '' : 's'} ${formData.drop_worst_runs === 1 ? 'is' : 'are'} dropped before scoring. Only applies once everyone who has raced has the same number of runs, with at least ${formData.drop_worst_runs + 1} each — otherwise nothing is dropped, and the standings say so.`
                                        : "Off. Set above 0 to drop each racer's worst runs before scoring — everyone who has raced needs the same number of runs to drop from, with one to spare."}
                                </p>
                            </div>

                            {/* Which way a tie is settled (#540) — beside Scoring, since
                                choosing one is what makes ties common or rare. Every
                                option's description is always visible (#304), not only the
                                one currently picked, and an option whose data this race
                                cannot produce says so rather than being hidden. */}
                            <fieldset style={fieldsetStyle}>
                                <legend style={legendStyle}>Ties</legend>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {TIEBREAKER_OPTIONS.map(option => {
                                        const wontFire = tiebreakerWontFire(
                                            option.value,
                                            formData.scoring_strategy,
                                            trackTimerType,
                                        );
                                        return (
                                            <label key={option.value} style={{ display: 'block', cursor: 'pointer' }}>
                                                <input
                                                    type="radio"
                                                    name="race-tiebreaker"
                                                    checked={formData.tiebreaker === option.value}
                                                    onChange={() => handleChange('tiebreaker', option.value)}
                                                />{' '}
                                                {option.label}
                                                <small style={optionDescriptionStyle}>
                                                    {option.description}
                                                </small>
                                                {wontFire && (
                                                    <small
                                                        style={{ color: 'var(--warning-soft-color)', display: 'block', marginTop: '0.15rem', marginLeft: '1.4rem' }}
                                                    >
                                                        Won&apos;t fire for this race — Points scoring on a track with no
                                                        timer never records a time to compare.
                                                    </small>
                                                )}
                                            </label>
                                        );
                                    })}
                                </div>
                            </fieldset>

                            {/* The championship and the trophies. How many go to the final is
                                the wizard's default; the two rules under it (edit-only) are
                                about who gets to keep which trophy once the final is decided —
                                all three are "who wins", which is why they are here rather
                                than on the Awards page or beside the track. */}
                            <div>
                                <label style={labelStyle} htmlFor="race-trophies">Championship Trophies</label>
                                <input
                                    id="race-trophies"
                                    type="number"
                                    value={formData.championship_trophies || 3}
                                    onChange={e => handleChange('championship_trophies', parseInt(e.target.value) || 3)}
                                    min={MIN_CHAMPIONSHIP_TROPHIES}
                                    max={MAX_CHAMPIONSHIP_TROPHIES}
                                    className="form-control"
                                    style={inputStyle}
                                />
                                <p style={helpStyle}>
                                    How many {vehiclesLower} the round wizard puts into the final. About the racing,
                                    not the physical trophies — those are on the Awards page.
                                </p>
                            </div>

                            {/* The Grand Finals half of #548: once a championship round is
                                decided, its winner stops counting toward the standings of
                                the round they qualified from, so the pack champion does not
                                also keep their own den's trophy. Update-only for the same
                                reason the running order checkbox is — there is no
                                championship round to decide until the race, and its rounds,
                                already exist. */}
                            {isEditing && (
                                <div>
                                    <label style={checkboxLabelStyle}>
                                        <input
                                            type="checkbox"
                                            id="race-exclude-round-winners"
                                            checked={formData.exclude_round_winners_from_qualifying_standings}
                                            onChange={e => setFormData(prev => ({ ...prev, exclude_round_winners_from_qualifying_standings: e.target.checked }))}
                                        />
                                        <span>Exclude Grand Finals winners from qualifying standings</span>
                                    </label>
                                    <p style={helpStyle}>
                                        Once a championship round has a winner, that {vehicleLower} stops counting toward the
                                        standings it qualified from — so the same {vehicleLower} does not win both the overall
                                        trophy and their own {groupLower}&apos;s.
                                    </p>
                                </div>
                            )}

                            {/* At most one trophy per racer (#615): a racer who already
                                holds an award is skipped when resolving a later one, so a
                                den speed trophy rolls down to the next fastest car once its
                                own winner has already taken the pack championship. Update-
                                only for the same reason the checkbox above is — there is
                                nothing yet to roll down between until the race, and its
                                awards, already exist. */}
                            {isEditing && (
                                <div>
                                    <label style={checkboxLabelStyle}>
                                        <input
                                            type="checkbox"
                                            id="race-one-trophy-per-racer"
                                            checked={formData.one_trophy_per_racer}
                                            onChange={e => setFormData(prev => ({ ...prev, one_trophy_per_racer: e.target.checked }))}
                                        />
                                        <span>At most one trophy per racer</span>
                                    </label>
                                    <p style={helpStyle}>
                                        A {vehicleLower} that already holds an award is skipped for a later one — so the
                                        {' '}{groupLower} trophy rolls down to the next-fastest {vehicleLower} once its own
                                        winner has already taken the overall trophy. Set up which award comes first on the
                                        Awards page&apos;s running order.
                                    </p>
                                </div>
                            )}
                        </section>
                    )}

                    {/* ---- Check-in: numbers and the scale ---- */}
                    {shows('checkin') && (
                        <section aria-labelledby="race-section-checkin" data-testid="race-section-checkin">
                            <GroupHeading id="checkin" sectioned={sectioned} />

                            <div>
                                <label style={labelStyle} htmlFor="race-car-numbering">{vehicle} Numbering</label>
                                <select
                                    id="race-car-numbering"
                                    value={formData.car_numbering_strategy}
                                    onChange={e => handleChange('car_numbering_strategy', e.target.value)}
                                    className="form-control"
                                    style={inputStyle}
                                >
                                    <option value="MANUAL">Manual</option>
                                    <option value="PER_GROUP">Per {group}</option>
                                    <option value="GLOBAL">Global</option>
                                </select>
                            </div>
                            {formData.car_numbering_strategy === 'GLOBAL' && (
                                <div>
                                    <label style={labelStyle} htmlFor="race-global-start">Global Start Number</label>
                                    <input
                                        id="race-global-start"
                                        type="number"
                                        value={formData.global_start_number}
                                        onChange={e => handleChange('global_start_number', parseInt(e.target.value) || 1)}
                                        className="form-control"
                                        style={inputStyle}
                                        placeholder="e.g. 1"
                                    />
                                </div>
                            )}

                            {/* The weight limit (#205). A checkbox as well as a number,
                                because "no limit" and "a limit of nothing" are different
                                answers and an empty box cannot tell them apart. */}
                            <div>
                                <label style={checkboxLabelStyle}>
                                    <input
                                        type="checkbox"
                                        id="race-check-weights"
                                        checked={formData.weight_limit_oz != null}
                                        onChange={e =>
                                            setFormData(prev => ({
                                                ...prev,
                                                weight_limit_oz: e.target.checked ? DEFAULT_LIMIT_OZ : null,
                                            }))
                                        }
                                    />
                                    <span>Check {vehicleLower} weights at inspection</span>
                                </label>
                                {formData.weight_limit_oz != null && (
                                    <>
                                        <label style={labelStyle} htmlFor="race-weight-limit">Weight Limit (oz)</label>
                                        <input
                                            id="race-weight-limit"
                                            type="number"
                                            step="0.01"
                                            min="0.01"
                                            value={formatOunces(formData.weight_limit_oz)}
                                            onChange={e =>
                                                handleChange('weight_limit_oz', parseFloat(e.target.value) || DEFAULT_LIMIT_OZ)
                                            }
                                            className="form-control"
                                            style={inputStyle}
                                        />
                                    </>
                                )}
                                <p style={helpStyle}>
                                    Check-in warns when a {vehicleLower} is over this. It is a warning, not a
                                    refusal — the inspector decides.
                                </p>
                            </div>
                        </section>
                    )}

                    {/* ---- Words and names: what strangers read ---- */}
                    {/* Both controls here are update-only — `updateRace` is the only
                        mutation that accepts them — so on the create form this whole
                        section is absent rather than an empty heading. */}
                    {isEditing && shows('words') && (
                        <section aria-labelledby="race-section-words" data-testid="race-section-words">
                            <GroupHeading id="words" sectioned={sectioned} />

                            {/* A per-race terminology override (#496 stage 3; #551 adds the
                                vehicle pair). Only offered once a race exists to override —
                                `updateRace` is the only mutation that accepts these fields,
                                so there is nothing to submit while creating. Same
                                checkbox-plus-fields shape as the weight limit, and the
                                same reason: "inherited" and "set to the same word" are
                                different answers. The inputs are `required` and
                                `firstProblem` checks them too: an empty word saved here
                                renders as nothing everywhere the word is used. */}
                            <div>
                                <label style={checkboxLabelStyle}>
                                    <input
                                        type="checkbox"
                                        id="race-custom-terminology"
                                        checked={formData.racing_group_singular != null}
                                        onChange={e =>
                                            setFormData(prev => ({
                                                ...prev,
                                                ...(e.target.checked
                                                    ? {
                                                        racing_group_singular: DEFAULT_TERMINOLOGY.racingGroupSingular,
                                                        racing_group_plural: DEFAULT_TERMINOLOGY.racingGroupPlural,
                                                        organization_singular: DEFAULT_TERMINOLOGY.organizationSingular,
                                                        organization_plural: DEFAULT_TERMINOLOGY.organizationPlural,
                                                        vehicle_singular: DEFAULT_TERMINOLOGY.vehicleSingular,
                                                        vehicle_plural: DEFAULT_TERMINOLOGY.vehiclePlural,
                                                        vehicle_artwork_key: DEFAULT_TERMINOLOGY.vehicleArtworkKey,
                                                    }
                                                    : {
                                                        racing_group_singular: null,
                                                        racing_group_plural: null,
                                                        organization_singular: null,
                                                        organization_plural: null,
                                                        vehicle_singular: null,
                                                        vehicle_plural: null,
                                                        vehicle_artwork_key: null,
                                                    }),
                                            }))
                                        }
                                    />
                                    <span>Use different words for this race</span>
                                </label>
                                {formData.racing_group_singular != null && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.5rem' }}>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-racing-group-singular">One racing group</label>
                                            <input
                                                id="race-racing-group-singular"
                                                type="text"
                                                value={formData.racing_group_singular ?? ''}
                                                onChange={e => handleChange('racing_group_singular', e.target.value)}
                                                required
                                                className="form-control"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-racing-group-plural">More than one</label>
                                            <input
                                                id="race-racing-group-plural"
                                                type="text"
                                                value={formData.racing_group_plural ?? ''}
                                                onChange={e => handleChange('racing_group_plural', e.target.value)}
                                                required
                                                className="form-control"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-organization-singular">The organization itself</label>
                                            <input
                                                id="race-organization-singular"
                                                type="text"
                                                value={formData.organization_singular ?? ''}
                                                onChange={e => handleChange('organization_singular', e.target.value)}
                                                required
                                                className="form-control"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-organization-plural">More than one</label>
                                            <input
                                                id="race-organization-plural"
                                                type="text"
                                                value={formData.organization_plural ?? ''}
                                                onChange={e => handleChange('organization_plural', e.target.value)}
                                                required
                                                className="form-control"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-vehicle-singular">One vehicle</label>
                                            <input
                                                id="race-vehicle-singular"
                                                type="text"
                                                value={formData.vehicle_singular ?? ''}
                                                onChange={e => handleChange('vehicle_singular', e.target.value)}
                                                required
                                                className="form-control"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-vehicle-plural">More than one</label>
                                            <input
                                                id="race-vehicle-plural"
                                                type="text"
                                                value={formData.vehicle_plural ?? ''}
                                                onChange={e => handleChange('vehicle_plural', e.target.value)}
                                                required
                                                className="form-control"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle} htmlFor="race-vehicle-artwork-key">Vehicle picture</label>
                                            <select
                                                id="race-vehicle-artwork-key"
                                                value={formData.vehicle_artwork_key ?? DEFAULT_TERMINOLOGY.vehicleArtworkKey}
                                                onChange={e => handleChange('vehicle_artwork_key', e.target.value)}
                                                className="form-control"
                                                style={inputStyle}
                                            >
                                                {VEHICLE_ARTWORK_OPTIONS.map(option => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                                <p style={{ ...helpStyle, marginTop: 0 }}>
                                    Overrides the install-wide default from System Settings, for this race only.
                                </p>
                            </div>

                            {/* A per-race name-display override (#552). Same checkbox-plus-
                                fields shape as the terminology override above, and the same
                                reason: 'FULL' set explicitly ("show full names at this race
                                regardless of the organization's own setting") is a
                                different answer from inheriting, so the checkbox is on
                                exactly when this is non-null. Every option's description
                                stays visible (#304), the same shape the tiebreaker picker
                                uses. Only offered once a race exists to override —
                                `updateRace` is the only mutation that accepts this field. */}
                            <div>
                                <label style={checkboxLabelStyle}>
                                    <input
                                        type="checkbox"
                                        id="race-custom-name-display"
                                        checked={formData.name_display != null}
                                        onChange={e =>
                                            setFormData(prev => ({
                                                ...prev,
                                                name_display: e.target.checked ? 'FULL' : null,
                                            }))
                                        }
                                    />
                                    <span>Override names on public screens for this race</span>
                                </label>
                                {formData.name_display != null && (
                                    <fieldset style={{ ...fieldsetStyle, marginBottom: '0.5rem' }}>
                                        <legend style={legendStyle}>Names on public screens</legend>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                            {NAME_DISPLAY_OPTIONS.map(option => (
                                                <label key={option.value} style={{ display: 'block', cursor: 'pointer' }}>
                                                    <input
                                                        type="radio"
                                                        name="race-name-display"
                                                        checked={formData.name_display === option.value}
                                                        onChange={() => handleChange('name_display', option.value)}
                                                    />{' '}
                                                    {option.label}
                                                    <small style={optionDescriptionStyle}>
                                                        {option.description}
                                                    </small>
                                                </label>
                                            ))}
                                        </div>
                                    </fieldset>
                                )}
                                <p style={{ ...helpStyle, marginTop: 0 }}>
                                    Overrides the install-wide default from System Settings, for this race only.
                                </p>
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {/* The buttons sit under the whole layout, nav and all, so Save is
                in the same place whichever section is up. */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '1rem', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '10px', flex: 1 }}>
                     <button type="submit" disabled={loading || !hasTrack} className="primary-btn" style={{ flex: 1, padding: '12px' }}>
                        {loading ? 'Saving...' : submitLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="secondary-btn"
                        style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted-color)' }}
                    >
                        Cancel
                    </button>
                </div>

                {onDelete && (
                     <button
                        type="button"
                        onClick={onDelete}
                        className="secondary-btn"
                        style={{
                            backgroundColor: 'var(--danger-bg-color)',
                            color: 'var(--danger-strong-color)',
                            border: '1px solid var(--danger-border-color)',
                            marginLeft: 'auto'
                        }}
                    >
                        Delete Race
                    </button>
                )}
            </div>
        </form>
    );
}
