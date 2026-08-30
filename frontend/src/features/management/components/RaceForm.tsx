import React, { useState, useMemo } from 'react';

import { DEFAULT_LIMIT_OZ, formatOunces } from '../weightCheck';
import { DEFAULT_TERMINOLOGY } from '../../settings/terminologyDefaults';
import { useTerminology } from '../../../context/TerminologyContext';
import { SHARED, TIEBREAKER_OPTIONS, tiebreakerWontFire } from '../../stats/tiebreakText';

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
    car_numbering_strategy: string;
    global_start_number: number;
    championship_trophies: number;
    /** The pack's weight limit in ounces, or null for no check (#205). */
    weight_limit_oz?: number | null;
    /**
     * A per-race terminology override, null where this race inherits the
     * organization's word (#496 stage 3; #551 adds the vehicle pair). All
     * six travel together — the checkbox below is on when any is non-null,
     * and turning it off clears all six rather than leaving a partial
     * override behind.
     */
    racing_group_singular?: string | null;
    racing_group_plural?: string | null;
    organization_singular?: string | null;
    organization_plural?: string | null;
    vehicle_singular?: string | null;
    vehicle_plural?: string | null;
}


interface RaceFormProps {
    initialData?: Partial<RaceFormData>;
    onSubmit: (data: RaceFormData) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
    submitLabel?: string;
    /**
     * Whether this is editing an existing race rather than creating one.
     * The terminology override only exists on `updateRace` — a race being
     * created has nothing yet to override, and always inherits the
     * organization's default until edited afterward.
     */
    isEditing?: boolean;
}

import { useQuery } from 'urql';
import { GET_TRACKS } from '../../core/graphql/queries';

export default function RaceForm({ initialData, onSubmit, onCancel, onDelete, submitLabel = 'Save', isEditing = false }: RaceFormProps) {
    const { group } = useTerminology();
    const [formData, setFormData] = useState<RaceFormData>({
        name: '',
        date_time: '',
        location: '',
        organization_id: 1, // Default
        track_id: 0,
        scoring_strategy: 'TIMED',
        tiebreaker: SHARED,
        car_numbering_strategy: 'GLOBAL',
        global_start_number: 1,
        championship_trophies: 3,
        // New races are offered the near-universal pack rule; an existing race
        // keeps whatever it has, including nothing. The column has no server
        // default on purpose — see the model.
        weight_limit_oz: DEFAULT_LIMIT_OZ,
        ...initialData
    });
    const [loading, setLoading] = useState(false);
    const [tracksResult] = useQuery({ query: GET_TRACKS });
    const tracks = useMemo(() => tracksResult.data?.tracks || [], [tracksResult.data?.tracks]);
    const fetchingTracks = tracksResult.fetching;

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
        setLoading(true);
        try {
            await onSubmit({
                ...formData,
                track_id: trackId,
                name: formData.name.trim()
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

    return (
        <form onSubmit={handleSubmit}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                    <label style={labelStyle} htmlFor="race-scoring">Scoring</label>
                    <select
                        id="race-scoring"
                        value={formData.scoring_strategy}
                        onChange={e => handleChange('scoring_strategy', e.target.value)}
                        className="form-control"
                        style={inputStyle}
                    >
                        <option value="TIMED">Timed (Fastest Avg Time)</option>
                        <option value="POINTS">Points (1st=1pt, 2nd=2pts...)</option>
                    </select>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="race-trophies">Championship Trophies</label>
                    <input
                        id="race-trophies"
                        type="number"
                        value={formData.championship_trophies || 3}
                        onChange={e => handleChange('championship_trophies', parseInt(e.target.value) || 3)}
                        min="1"
                        max="10"
                        className="form-control"
                        style={inputStyle}
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                        Number of trophies to award for the championship.
                    </p>
                </div>
            </div>

            {/* Which way a tie is settled (#540) — beside Scoring, since
                choosing one is what makes ties common or rare. Every
                option's description is always visible (#304), not only the
                one currently picked, and an option whose data this race
                cannot produce says so rather than being hidden. */}
            <fieldset style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                <legend style={{ fontSize: '0.9rem', padding: '0 0.4rem' }}>Ties</legend>
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
                                <small style={{ color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem', marginLeft: '1.4rem' }}>
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

            {/* The weight limit (#205). A checkbox as well as a number,
                because "no limit" and "a limit of nothing" are different
                answers and an empty box cannot tell them apart. */}
            <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
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
                    <span>Check car weights at inspection</span>
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
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                    Check-in warns when a car is over this. It is a warning, not a refusal —
                    the inspector decides.
                </p>
            </div>

            {/* A per-race terminology override (#496 stage 3; #551 adds the
                vehicle pair). Only offered once a race exists to override —
                `updateRace` is the only mutation that accepts these fields,
                so there is nothing to submit while creating. Same
                checkbox-plus-fields shape as the weight limit above, and the
                same reason: "inherited" and "set to the same word" are
                different answers. */}
            {isEditing && (
                <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
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
                                        }
                                        : {
                                            racing_group_singular: null,
                                            racing_group_plural: null,
                                            organization_singular: null,
                                            organization_plural: null,
                                            vehicle_singular: null,
                                            vehicle_plural: null,
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
                                    className="form-control"
                                    style={inputStyle}
                                />
                            </div>
                        </div>
                    )}
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', marginTop: 0, marginBottom: '1rem' }}>
                        Overrides the install-wide default from System Settings, for this race only.
                    </p>
                </div>
            )}

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
            </div>

            <div>
                <label style={labelStyle} htmlFor="race-car-numbering">Car Numbering</label>
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
