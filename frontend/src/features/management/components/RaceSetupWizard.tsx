import { useMemo, useState } from 'react';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiClose, mdiPlus } from '@mdi/js';

import { DEFAULT_TERMINOLOGY, type Terminology } from '../../../context/TerminologyContext';
import { GET_RACE_SETUP_CONTEXT, GET_RACE_SETUP_SOURCE } from '../graphql/queries';
import { CATEGORY_PRESETS } from '../categoryPresets';
import type { RaceSetupData } from '../raceInput';
import {
    DEFAULT_ANSWERS,
    EVENT_KINDS,
    ORGANIZATION_KINDS,
    blankGroup,
    copiedGroups,
    firstGroupProblem,
    organizationKindFor,
    prefillFromRace,
    raceOverrideFor,
    scaffoldGroups,
    stepsFor,
    wordsFor,
    type GroupProblem,
    type RacingGroupDraft,
    type SetupAnswers,
    type SetupMode,
    type SourceRace,
    type StepId,
} from '../raceSetup';
import RaceForm, { type RaceFormData } from './RaceForm';

/**
 * The race setup wizard (#662): a few questions in front of the create-race
 * form, so a race opens with its groups already made and its words already
 * chosen.
 *
 * Every rule here is `raceSetup.ts`'s; this is the wiring. The last step
 * *is* `RaceForm` in its flat create mode (#587) — a first-timer still
 * meets every field once, in order — and the wizard only adds what that
 * form could not ask: what is being raced, who is holding it, and which
 * groups to start with. Or, for a returning pack, which previous race to
 * copy all of that from.
 *
 * The form stays mounted (hidden) once reached, so going back to fix a
 * group's name does not lose a race name already typed; it is keyed on what
 * it was prefilled with, so a change to the answers that *would* change the
 * prefill remounts it rather than showing stale words.
 */

interface RaceSetupWizardProps {
    onSubmit: (data: RaceSetupData) => Promise<void>;
    onCancel: () => void;
}

interface PreviousRace {
    id: number;
    name: string;
    dateTime?: string | null;
}

const STEP_LABELS: Record<Exclude<StepId, 'groups'>, string> = {
    start: 'Start',
    kind: 'Kind of event',
    details: 'Details',
};

const labelStyle = {
    display: 'block',
    fontSize: '0.9rem',
    marginBottom: '0.5rem',
    color: 'var(--text-strong-muted-color)',
    fontWeight: 'bold',
} as const;

const helpStyle = { fontSize: '0.8rem', color: 'var(--text-muted-color)', margin: '0 0 1rem' } as const;

const fieldsetStyle = { border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' } as const;
const legendStyle = { fontSize: '0.9rem', padding: '0 0.4rem', fontWeight: 'bold' } as const;
const optionStyle = { display: 'block', cursor: 'pointer', marginBottom: '0.5rem' } as const;
const optionDescriptionStyle = { color: 'var(--text-muted-color)', display: 'block', marginTop: '0.15rem', marginLeft: '1.4rem' } as const;

const cellInputStyle = { width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', font: 'inherit' } as const;

export default function RaceSetupWizard({ onSubmit, onCancel }: RaceSetupWizardProps) {
    const [context] = useQuery({ query: GET_RACE_SETUP_CONTEXT });
    const previousRaces: PreviousRace[] = useMemo(
        () => [...(context.data?.races ?? [])].reverse(),
        [context.data?.races],
    );
    const installDefault: Terminology = context.data?.initialConfig?.terminology ?? DEFAULT_TERMINOLOGY;
    const hasPrevious = previousRaces.length > 0;

    const [mode, setMode] = useState<SetupMode>('scratch');
    const [sourceRaceId, setSourceRaceId] = useState<number | null>(null);
    const [answers, setAnswers] = useState<SetupAnswers>(DEFAULT_ANSWERS);
    const [groups, setGroups] = useState<RacingGroupDraft[]>([]);
    // What the groups list was last scaffolded or copied from, so a trip
    // back through the questions reseeds only when the answer that matters
    // actually changed — edits survive a look back that changes nothing.
    const [seededFrom, setSeededFrom] = useState<string | null>(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [problem, setProblem] = useState<GroupProblem | null>(null);
    const [detailsReached, setDetailsReached] = useState(false);

    const [source] = useQuery({
        query: GET_RACE_SETUP_SOURCE,
        variables: { raceId: sourceRaceId ?? 0 },
        pause: mode !== 'copy' || sourceRaceId === null,
    });
    const sourceRace: SourceRace | null = source.data?.race ?? null;

    const steps = stepsFor(mode, hasPrevious);
    const step: StepId = steps[Math.min(stepIndex, steps.length - 1)];

    // The words this race will use — the answers', or the copied race's own
    // override laid over the install default, which is how the server would
    // resolve them once the race exists.
    const chosenWords: Terminology = useMemo(() => {
        if (mode === 'copy' && sourceRace) {
            return {
                racingGroupSingular: sourceRace.racingGroupSingular ?? installDefault.racingGroupSingular,
                racingGroupPlural: sourceRace.racingGroupPlural ?? installDefault.racingGroupPlural,
                organizationSingular: sourceRace.organizationSingular ?? installDefault.organizationSingular,
                organizationPlural: sourceRace.organizationPlural ?? installDefault.organizationPlural,
                vehicleSingular: sourceRace.vehicleSingular ?? installDefault.vehicleSingular,
                vehiclePlural: sourceRace.vehiclePlural ?? installDefault.vehiclePlural,
                vehicleArtworkKey: sourceRace.vehicleArtworkKey ?? installDefault.vehicleArtworkKey,
            };
        }
        return wordsFor(answers);
    }, [mode, sourceRace, answers, installDefault]);
    const groupWords = {
        group: chosenWords.racingGroupSingular,
        groups: chosenWords.racingGroupPlural,
        groupLower: chosenWords.racingGroupSingular.toLowerCase(),
        groupsLower: chosenWords.racingGroupPlural.toLowerCase(),
    };

    const prefill: Partial<RaceFormData> = useMemo(
        () =>
            mode === 'copy' && sourceRace
                ? prefillFromRace(sourceRace)
                : raceOverrideFor(chosenWords, installDefault),
        [mode, sourceRace, chosenWords, installDefault],
    );
    const prefillKey = JSON.stringify(prefill);

    const categoryPresets =
        mode === 'copy' ? CATEGORY_PRESETS : organizationKindFor(answers.organizationKind).categoryPresets;

    const goTo = (index: number) => {
        setProblem(null);
        setStepIndex(index);
    };

    const next = () => {
        if (step === 'start' && mode === 'copy') {
            if (!sourceRace) return;
            const key = `copy:${sourceRace.id}`;
            if (seededFrom !== key) {
                setGroups(copiedGroups(sourceRace.racingGroups));
                setSeededFrom(key);
            }
        }
        if (step === 'kind') {
            const key = `scratch:${answers.organizationKind}:${answers.scale}`;
            if (seededFrom !== key) {
                setGroups(scaffoldGroups(answers));
                setSeededFrom(key);
            }
        }
        if (step === 'groups') {
            const found = firstGroupProblem(groups, groupWords);
            if (found) {
                setProblem(found);
                return;
            }
            setDetailsReached(true);
        }
        goTo(stepIndex + 1);
    };

    const back = () => {
        if (stepIndex === 0) {
            onCancel();
            return;
        }
        goTo(stepIndex - 1);
    };

    const updateGroup = (index: number, patch: Partial<RacingGroupDraft>) => {
        setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
        setProblem(null);
    };

    const removeGroup = (index: number) => {
        setGroups((prev) => prev.filter((_, i) => i !== index));
        setProblem(null);
    };

    const handleDetails = async (data: RaceFormData) => {
        await onSubmit({ ...data, racing_groups: groups });
    };

    const stepLabel = (id: StepId) => (id === 'groups' ? chosenWords.racingGroupPlural : STEP_LABELS[id]);

    if (context.fetching && !context.data) {
        return <p style={helpStyle}>Loading…</p>;
    }

    return (
        <div data-testid="race-setup-wizard">
            {/* Where we are. A list rather than a bare "Step 2 of 4", so the
                operator can see what is still to come — and see that the last
                step is the form itself. */}
            <ol
                aria-label="Setup steps"
                style={{ display: 'flex', gap: '0.5rem', listStyle: 'none', padding: 0, margin: '0 0 1rem', flexWrap: 'wrap' }}
            >
                {steps.map((id, i) => (
                    <li
                        key={id}
                        aria-current={id === step ? 'step' : undefined}
                        style={{
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '999px',
                            border: '1px solid var(--border-color)',
                            background: id === step ? 'var(--scouting-blue)' : 'transparent',
                            color: id === step ? 'var(--on-primary-color)' : 'var(--text-muted-color)',
                        }}
                    >
                        {i + 1}. {stepLabel(id)}
                    </li>
                ))}
            </ol>

            {step === 'start' && (
                <section data-testid="setup-step-start">
                    <fieldset style={fieldsetStyle}>
                        <legend style={legendStyle}>How would you like to begin?</legend>
                        <label style={optionStyle}>
                            <input
                                type="radio"
                                name="setup-mode"
                                checked={mode === 'scratch'}
                                onChange={() => setMode('scratch')}
                            />{' '}
                            Start from scratch
                            <small style={optionDescriptionStyle}>
                                Answer two questions and get a ready-made list of{' '}
                                {installDefault.racingGroupPlural.toLowerCase()} to adjust.
                            </small>
                        </label>
                        <label style={optionStyle}>
                            <input
                                type="radio"
                                name="setup-mode"
                                checked={mode === 'copy'}
                                onChange={() => setMode('copy')}
                            />{' '}
                            Copy settings from a previous race
                            <small style={optionDescriptionStyle}>
                                Its {installDefault.racingGroupPlural.toLowerCase()}, scoring, numbering and words, ready
                                to adjust. The roster is not copied.
                            </small>
                        </label>
                    </fieldset>
                    {mode === 'copy' && (
                        <div>
                            <label style={labelStyle} htmlFor="setup-source-race">Previous race</label>
                            <select
                                id="setup-source-race"
                                className="form-control"
                                value={sourceRaceId ?? ''}
                                onChange={(e) => setSourceRaceId(e.target.value ? Number(e.target.value) : null)}
                                style={{ marginBottom: '0.5rem' }}
                            >
                                <option value="">Choose a race…</option>
                                {previousRaces.map((race) => (
                                    <option key={race.id} value={race.id}>
                                        {race.name}
                                        {race.dateTime ? ` — ${new Date(race.dateTime).toLocaleDateString()}` : ''}
                                    </option>
                                ))}
                            </select>
                            {sourceRaceId !== null && source.fetching && <p style={helpStyle}>Loading that race…</p>}
                            {sourceRace && (
                                <p style={helpStyle} data-testid="setup-source-summary">
                                    {sourceRace.racingGroups.length === 0
                                        ? `That race has no ${groupWords.groupsLower} to copy; you can add some on the next step.`
                                        : `${sourceRace.racingGroups.length} ${
                                            sourceRace.racingGroups.length === 1 ? groupWords.groupLower : groupWords.groupsLower
                                        } to copy: ${sourceRace.racingGroups.map((g) => g.name).join(', ')}.`}
                                </p>
                            )}
                        </div>
                    )}
                </section>
            )}

            {step === 'kind' && (
                <section data-testid="setup-step-kind">
                    <fieldset style={fieldsetStyle}>
                        <legend style={legendStyle}>What is being raced?</legend>
                        {EVENT_KINDS.map((kind) => (
                            <label key={kind.key} style={optionStyle}>
                                <input
                                    type="radio"
                                    name="setup-event-kind"
                                    checked={answers.eventKind === kind.key}
                                    onChange={() => setAnswers((a) => ({ ...a, eventKind: kind.key }))}
                                />{' '}
                                {kind.label}
                                <small style={optionDescriptionStyle}>{kind.description}</small>
                            </label>
                        ))}
                    </fieldset>
                    <fieldset style={fieldsetStyle}>
                        <legend style={legendStyle}>Who is holding it?</legend>
                        {ORGANIZATION_KINDS.map((kind) => (
                            <label key={kind.key} style={optionStyle}>
                                <input
                                    type="radio"
                                    name="setup-organization-kind"
                                    checked={answers.organizationKind === kind.key}
                                    onChange={() => setAnswers((a) => ({ ...a, organizationKind: kind.key }))}
                                />{' '}
                                {kind.label}
                                <small style={optionDescriptionStyle}>{kind.description}</small>
                            </label>
                        ))}
                    </fieldset>
                    {organizationKindFor(answers.organizationKind).scales && (
                        <fieldset style={fieldsetStyle}>
                            <legend style={legendStyle}>How big is it?</legend>
                            {organizationKindFor(answers.organizationKind).scales!.map((scale) => (
                                <label key={scale.key} style={optionStyle}>
                                    <input
                                        type="radio"
                                        name="setup-scale"
                                        checked={answers.scale === scale.key}
                                        onChange={() => setAnswers((a) => ({ ...a, scale: scale.key }))}
                                    />{' '}
                                    {scale.label}
                                    <small style={optionDescriptionStyle}>{scale.description}</small>
                                </label>
                            ))}
                        </fieldset>
                    )}
                    <p style={helpStyle} data-testid="setup-words-summary">
                        This race will say <strong>{chosenWords.organizationSingular}</strong>,{' '}
                        <strong>{chosenWords.racingGroupSingular}</strong> and{' '}
                        <strong>{chosenWords.vehicleSingular}</strong>. You can change any of the words later, under
                        the race&apos;s <em>Words and names</em> settings.
                    </p>
                </section>
            )}

            {step === 'groups' && (
                <section data-testid="setup-step-groups">
                    <p style={{ ...helpStyle, marginTop: 0 }}>
                        {groups.length === 0
                            ? `Add the ${groupWords.groupsLower} racers will be grouped into — or leave the list empty if this race does not group them.`
                            : `Adjust the ${groupWords.groupsLower} below, or remove the ones this race does not need. Each one is offered a block of numbers of its own; clear them if you number some other way.`}
                    </p>
                    {problem && (
                        <p
                            role="alert"
                            data-testid="setup-problem"
                            style={{
                                color: 'var(--error)',
                                border: '1px solid var(--error)',
                                borderRadius: '8px',
                                padding: '0.5rem 0.75rem',
                                margin: '0 0 1rem',
                                fontSize: '0.9rem',
                            }}
                        >
                            {problem.message}
                        </p>
                    )}
                    {groups.length > 0 && (
                        <div
                            role="grid"
                            aria-label={groupWords.groups}
                            style={{ display: 'grid', gridTemplateColumns: '2.5rem 1.6fr 1.2fr 5rem 5rem 2rem', gap: '0.4rem 0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}
                        >
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-strong-muted-color)' }}>Color</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-strong-muted-color)' }}>Name</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-strong-muted-color)' }}>Category</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-strong-muted-color)' }}>Start #</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-strong-muted-color)' }}>End #</span>
                            <span />
                            {groups.map((group, i) => {
                                const n = i + 1;
                                const flagged = problem?.index === i;
                                const rowInputStyle = flagged ? { ...cellInputStyle, borderColor: 'var(--error)' } : cellInputStyle;
                                return (
                                    <div key={i} role="row" data-testid={`setup-group-row-${i}`} style={{ display: 'contents' }}>
                                        <input
                                            type="color"
                                            aria-label={`${groupWords.group} ${n} color`}
                                            value={group.color}
                                            onChange={(e) => updateGroup(i, { color: e.target.value })}
                                            style={{ width: '2.2rem', height: '2rem', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                                        />
                                        <input
                                            type="text"
                                            aria-label={`${groupWords.group} ${n} name`}
                                            value={group.name}
                                            onChange={(e) => updateGroup(i, { name: e.target.value })}
                                            style={rowInputStyle}
                                        />
                                        <input
                                            type="text"
                                            aria-label={`${groupWords.group} ${n} category`}
                                            list="setup-category-presets"
                                            value={group.division}
                                            onChange={(e) => updateGroup(i, { division: e.target.value })}
                                            style={cellInputStyle}
                                        />
                                        <input
                                            type="number"
                                            aria-label={`${groupWords.group} ${n} start number`}
                                            value={group.car_number_range_start ?? ''}
                                            onChange={(e) =>
                                                updateGroup(i, { car_number_range_start: e.target.value ? parseInt(e.target.value, 10) : undefined })
                                            }
                                            style={cellInputStyle}
                                        />
                                        <input
                                            type="number"
                                            aria-label={`${groupWords.group} ${n} end number`}
                                            value={group.car_number_range_end ?? ''}
                                            onChange={(e) =>
                                                updateGroup(i, { car_number_range_end: e.target.value ? parseInt(e.target.value, 10) : undefined })
                                            }
                                            style={cellInputStyle}
                                        />
                                        <button
                                            type="button"
                                            aria-label={`Remove ${groupWords.groupLower} ${n}`}
                                            data-testid={`setup-remove-group-${i}`}
                                            onClick={() => removeGroup(i)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)', padding: 0 }}
                                        >
                                            <Icon path={mdiClose} size={0.8} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {categoryPresets.length > 0 && (
                        <datalist id="setup-category-presets">
                            {categoryPresets.map((preset) => (
                                <option key={preset} value={preset} />
                            ))}
                        </datalist>
                    )}
                    <button
                        type="button"
                        className="secondary-btn"
                        data-testid="setup-add-group"
                        onClick={() => setGroups((prev) => [...prev, blankGroup(prev)])}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.75rem' }}
                    >
                        <Icon path={mdiPlus} size={0.8} /> Add {groupWords.groupLower}
                    </button>
                    <p style={helpStyle}>
                        You can add, rename or remove {groupWords.groupsLower} later from <em>Manage {groupWords.groups}</em>{' '}
                        on the Roster page.
                    </p>
                </section>
            )}

            {detailsReached && (
                <div hidden={step !== 'details'} data-testid="setup-step-details">
                    <RaceForm
                        key={prefillKey}
                        initialData={prefill}
                        onSubmit={handleDetails}
                        onCancel={back}
                        submitLabel="Create Race"
                        cancelLabel="Back"
                    />
                </div>
            )}

            {step !== 'details' && (
                <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                    <button
                        type="button"
                        className="primary-btn"
                        data-testid="setup-next"
                        onClick={next}
                        disabled={step === 'start' && mode === 'copy' && !sourceRace}
                        style={{ flex: 1, padding: '12px' }}
                    >
                        Next
                    </button>
                    <button
                        type="button"
                        className="secondary-btn"
                        data-testid="setup-back"
                        onClick={back}
                        style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted-color)' }}
                    >
                        {stepIndex === 0 ? 'Cancel' : 'Back'}
                    </button>
                </div>
            )}
        </div>
    );
}
