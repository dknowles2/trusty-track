/**
 * What to do next, on the page where it is done (#199).
 *
 * The rules are in `setupChecklist.ts`. This is the rendering and the wiring:
 * each step names the control that performs it, and the caller supplies the
 * handler, because two of the four are modals on the roster page and one is a
 * different screen entirely.
 */

import { Icon } from '@mdi/react';
import { mdiCheckCircle, mdiCircleOutline } from '@mdi/js';

import {
    checklistFor,
    nextStep,
    shouldShowChecklist,
    type SetupProgress,
    type StepKey,
} from '../setupChecklist';

interface Props {
    progress: SetupProgress;
    /** What each step's control does. A step with no handler shows no button. */
    onAction: Partial<Record<StepKey, () => void>>;
}

export default function SetupChecklist({ progress, onAction }: Props) {
    const steps = checklistFor(progress);
    if (!shouldShowChecklist(steps)) return null;

    const next = nextStep(steps);
    const doneCount = steps.filter((step) => step.done).length;

    return (
        <div
            data-testid="setup-checklist"
            style={{
                marginBottom: '2rem',
                background: 'var(--surface-color)',
                border: '1px solid var(--border-faint-color)',
                borderLeft: '4px solid var(--cub-scouting-gold)',
                borderRadius: '12px',
                padding: '1rem 1.25rem',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    marginBottom: '0.75rem',
                    flexWrap: 'wrap',
                }}
            >
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Setting up this race</h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                    {doneCount} of {steps.length} done
                </span>
            </div>

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
        </div>
    );
}
