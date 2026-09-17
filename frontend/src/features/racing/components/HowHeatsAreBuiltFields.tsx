import React from 'react';
import type { SchedulingAlgorithmsQuery } from '../../../gql/operations';
import FieldHelp from '../../../components/ui/FieldHelp';

export type SchedulingAlgorithmOption = SchedulingAlgorithmsQuery['schedulingAlgorithms'][number];

interface HowHeatsAreBuiltFieldsProps {
  algorithm: string;
  onChooseAlgorithm: (value: string) => void;
  /** `Query.schedulingAlgorithms` for the field/lane shape this round would
   * schedule — the caller queries it (`RoundWizard`/`RoundConfigModal` both
   * already have the racer and lane counts this needs), so this component
   * stays a plain display, the same split `HowItsRacedFields` and
   * `FormatFields` already follow. Empty while the query is in flight. */
  options: readonly SchedulingAlgorithmOption[];
  loading?: boolean;
  /** The label's own look differs between the two dialogs, same reason as
   * `HowItsRacedFields.labelStyle`. */
  labelStyle: React.CSSProperties;
  mutedColor: string;
}

/**
 * "How heats are built" (#1090, part D) — which registered algorithm
 * schedules a `GENERAL` round's heats. A choice beneath "How it's raced",
 * rendered only for that style by the caller — Elimination/Balanced build
 * their own schedules and never read `Round.algorithm` at all
 * (`.claude/rules/scheduling.md`'s "Heat scheduling (PPC)").
 *
 * **Collapsed by default, and a plain `<details>` rather than
 * `FieldHelp`** — most packs never open it (PPC, the default, is right for
 * every field size), and what needs collapsing here is the whole choice,
 * not one control's helper sentence the way `FieldHelp` collapses a single
 * paragraph on a narrow viewport. `FieldHelp` stays reserved for that
 * narrower job; this is closed on every viewport, not only a phone's.
 */
export const HowHeatsAreBuiltFields: React.FC<HowHeatsAreBuiltFieldsProps> = ({
  algorithm,
  onChooseAlgorithm,
  options,
  loading,
  labelStyle,
  mutedColor,
}) => {
  return (
    <details>
      <summary style={{ ...labelStyle, display: 'list-item', cursor: 'pointer' }}>
        How heats are built
      </summary>
      <FieldHelp
        id="how-heats-are-built-intro-help"
        as="small"
        style={{ color: mutedColor, display: 'block', marginTop: '4px' }}
        docs="how-heats-are-built"
      >
        Which algorithm decides who races whom, and how many times.
      </FieldHelp>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        {options.map((option) => {
          const disabled = loading || option.unavailableReason != null;
          const inputId = `how-heats-are-built-${option.value}`;
          const helpId = `${inputId}-help`;
          return (
            <div
              key={option.value}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                opacity: option.unavailableReason != null ? 0.6 : 1,
              }}
            >
              <input
                id={inputId}
                type="radio"
                checked={algorithm === option.value}
                onChange={() => onChooseAlgorithm(option.value)}
                disabled={disabled}
                aria-describedby={helpId}
                style={{ marginTop: '3px', cursor: disabled ? 'not-allowed' : 'pointer' }}
              />
              <div>
                <label
                  htmlFor={inputId}
                  style={{ display: 'block', cursor: disabled ? 'not-allowed' : 'pointer' }}
                >
                  {option.label}
                </label>
                <span id={helpId} style={{ display: 'block', fontSize: '0.75rem', color: mutedColor }}>
                  {option.unavailableReason ?? option.guarantee}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
};
