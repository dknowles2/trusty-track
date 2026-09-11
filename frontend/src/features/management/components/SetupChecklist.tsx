/**
 * What to do next, on the page where it is done (#199).
 *
 * The rules are in `setupChecklist.ts`. This is the rendering and the wiring:
 * each step names the control that performs it, and the caller supplies the
 * handler, because two of the four are modals on the roster page and one is a
 * different screen entirely.
 *
 * **Collapses to one line once check-in starts (#949).** `shouldCollapseChecklist`
 * is the rule; a native `<details>`/`<summary>` is the rendering, chosen
 * deliberately over an `if` that swaps in a different root element: every
 * `setup-step-*` row stays in the DOM (with its `data-done` attribute)
 * whether the checklist is open or closed, only *painted* by the browser's
 * own `details:not([open])` rule — so a test reading a step's done-ness
 * (`race-day.spec.ts`'s own) keeps working across the collapse without
 * caring which state it caught the page in.
 *
 * The collapse is sticky once the operator has touched it by hand — `open`
 * is controlled, but only re-derived from `shouldCollapseChecklist` on the
 * render where that answer actually *changes*, the same "adjust state
 * while rendering" comparison `RaceDetails.tsx` uses for its edit-modal
 * query param, rather than a `useEffect`. Once collapsed automatically, an
 * operator who reopens it to check a step is not fought back shut on the
 * next keystroke.
 */

import { useState } from 'react';
import { Icon } from '@mdi/react';
import { mdiCheckCircle, mdiCircleOutline } from '@mdi/js';

import {
    checklistFor,
    nextStep,
    outstandingSteps,
    shouldCollapseChecklist,
    shouldShowChecklist,
    type SetupProgress,
    type StepKey,
} from '../setupChecklist';
import { useTerminology } from '../../../context/TerminologyContext';

interface Props {
    progress: SetupProgress;
    /** What each step's control does. A step with no handler shows no button. */
    onAction: Partial<Record<StepKey, () => void>>;
}

export default function SetupChecklist({ progress, onAction }: Props) {
    const words = useTerminology();
    const steps = checklistFor(progress, words);
    const collapseByDefault = shouldCollapseChecklist(progress);

    // Mirrors `RaceDetails.tsx`'s own "adjust state while rendering"
    // comparison: `open` reacts to `collapseByDefault` exactly on the render
    // where it changes, and is otherwise whatever the operator last set by
    // clicking the summary — so the one automatic collapse, at the first
    // check-in, does not refire and refight a reopened panel on every
    // subsequent racer.
    const [open, setOpen] = useState(!collapseByDefault);
    const [prevCollapseByDefault, setPrevCollapseByDefault] = useState(collapseByDefault);
    if (collapseByDefault !== prevCollapseByDefault) {
        setPrevCollapseByDefault(collapseByDefault);
        if (collapseByDefault) setOpen(false);
    }

    if (!shouldShowChecklist(steps)) return null;

    const next = nextStep(steps);
    const doneCount = steps.filter((step) => step.done).length;
    const remaining = outstandingSteps(steps);

    return (
        <details
            data-testid="setup-checklist"
            open={open}
            onToggle={(e) => setOpen(e.currentTarget.open)}
            style={{
                // Collapsed is the common state once check-in has started
                // (#949) — the whole point is one line above the roster, so
                // its own padding and margin shrink to match rather than
                // keeping the room the six-row panel needs.
                marginBottom: open ? '2rem' : '1rem',
                background: 'var(--surface-color)',
                border: '1px solid var(--border-faint-color)',
                borderLeft: '4px solid var(--cub-scouting-gold)',
                borderRadius: '12px',
                padding: open ? '1rem 1.25rem' : '0.6rem 1.25rem',
            }}
        >
            <summary
                data-testid="setup-checklist-summary"
                style={{
                    // `display: flex` is what lays the count badge out
                    // beside the title, and it is also what makes Chromium
                    // drop the native disclosure triangle (that marker
                    // needs `display: list-item`) — so the arrow below is
                    // drawn by hand rather than relied on, the same
                    // "print/paint it yourself rather than trust the
                    // platform to" rule the printables decoration follows.
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                    cursor: 'pointer',
                    marginBottom: open ? '0.75rem' : 0,
                }}
            >
                {open ? (
                    <>
                        <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>▾ Setting up this race</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)', whiteSpace: 'nowrap' }}>
                            {doneCount} of {steps.length} done
                        </span>
                    </>
                ) : (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ▸ Setting up: {doneCount} of {steps.length} done — {remaining.map((step) => step.label).join(' · ')}
                    </span>
                )}
            </summary>

            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
                {steps.map((step) => {
                    // Only the step you are actually on carries its explanation.
                    // All four at once is a wall of text on a page whose job is
                    // to get somebody moving.
                    const isNext = next?.key === step.key;
                    const handler = onAction[step.key];
                    return (
                        <li
                            key={step.key}
                            data-testid={`setup-step-${step.key}`}
                            data-done={step.done ? 'true' : 'false'}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                flexWrap: 'wrap',
                            }}
                        >
                            <Icon
                                path={step.done ? mdiCheckCircle : mdiCircleOutline}
                                size={0.8}
                                color={step.done ? 'var(--success-color)' : 'var(--text-placeholder-color)'}
                            />
                            <span
                                style={{
                                    fontWeight: isNext ? 600 : 400,
                                    color: step.done ? 'var(--text-muted-color)' : 'var(--text-strong-color)',
                                    textDecoration: step.done ? 'line-through' : undefined,
                                }}
                            >
                                {step.label}
                            </span>
                            {isNext && (
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>{step.hint}</span>
                            )}
                            {isNext && step.action && handler && (
                                <button
                                    className="primary-btn"
                                    onClick={handler}
                                    style={{
                                        marginLeft: 'auto',
                                        padding: '4px 12px',
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    {step.action}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </details>
    );
}
