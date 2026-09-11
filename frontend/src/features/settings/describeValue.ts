/**
 * Turning a stored detail's raw value into words, at render time (#942).
 *
 * The activity log's detail line used to print `Scoring strategy: TIMED`,
 * `Tiebreaker: SHARED`, `Display theme: MATCH_APP` — an audit entry stores
 * exactly the arguments a mutation was called with (`domain/audit.redact`),
 * which for these fields is the internal enum value a form picker chose
 * from, not a word an operator ever typed or read. `domain/audit.describe`
 * renders the log's *sentence* from the entry alone and never looks
 * anything up ("The activity log" in `CLAUDE.md` — an entry is a claim
 * about a moment that has passed) — this is that same rule applied to the
 * *values* listed underneath the sentence: no fetch, no id resolved against
 * the database as it stands today, only the value the entry already stored,
 * read through the exact label tables the forms that wrote it already use.
 *
 * `field` is the leaf key — `detailPairs` in `activityLog.ts` strips the
 * `race.`/`config.` prefix a nested input's flattening adds before calling
 * this — matched with underscores and case folded away, so the stored
 * `scoring_strategy` and any differently-cased variant land on the same
 * case below.
 *
 * A field this module has never heard of, or a value none of the tables it
 * reads recognise, passes through unchanged: the same "print something
 * rather than throw" rule every label helper here already follows
 * (`strategyLabel`, `themeByKey`, `timerTypeLabel`).
 */

import { strategyLabel } from '../stats/scoringStrategyText';
import { TIEBREAKER_OPTIONS } from '../stats/tiebreakText';
import { numberingStrategyLabel } from '../management/raceSetup';
import { themeSettingLabel } from '../../theming/themes';
import { NAME_DISPLAY_OPTIONS } from '../core/displayName';
import { timerTypeLabel } from './timerTypeText';

function normalised(field: string): string {
    return field.toLowerCase().replace(/_/g, '');
}

export function describeValue(field: string, value: string): string {
    switch (normalised(field)) {
        case 'scoringstrategy':
            return strategyLabel(value);
        case 'tiebreaker':
            return TIEBREAKER_OPTIONS.find((option) => option.value === value)?.label ?? value;
        case 'carnumberingstrategy':
            return numberingStrategyLabel(value);
        case 'displaytheme':
        case 'printablestheme':
            return themeSettingLabel(value);
        case 'namedisplay':
            return NAME_DISPLAY_OPTIONS.find((option) => option.value === value)?.label ?? value;
        case 'timertype':
            return timerTypeLabel(value);
        default:
            return value;
    }
}
