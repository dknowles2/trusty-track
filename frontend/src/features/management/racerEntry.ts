/**
 * What survives between one hand-entered racer and the next (#202).
 *
 * CSV import covers packs that already have a spreadsheet. Plenty of rosters
 * are typed in instead, sixty of them in a sitting, and that was one modal
 * round trip each: open, fill, save, reopen, pick the racingGroup again.
 */

import type { RacerData } from './components/RacerForm';

/**
 * The form to show after saving, ready for the next racer.
 *
 * **The racingGroup carries over and nothing else does.** Rosters are entered racingGroup by
 * racingGroup, from a sheet that is grouped that way, so it is the one field where
 * repeating the last answer is right far more often than it is wrong.
 *
 * **The car number deliberately does not increment.** It is tempting, and it
 * would be wrong under `MANUAL` numbering, which is the only strategy where the
 * operator types a number at all — a hand-numbered pack's next car is not
 * reliably the last one plus one, and a wrong number that looks deliberate is
 * worse than a blank one. Under the other strategies the field is left empty
 * anyway and the server assigns it.
 *
 * **Inspection does not carry over either.** Adding a racer to the roster is
 * not the same act as inspecting their car, and a stuck-on toggle would check
 * in a queue of children who are not there yet.
 */
export function carryOver(previous: RacerData): RacerData {
    return {
        first_name: '',
        last_name: '',
        car_number: undefined,
        car_name: '',
        car_weight: undefined,
        racer_image_url: undefined,
        car_image_url: undefined,
        car_passed_inspection: false,
        racing_group_id: previous.racing_group_id,
    };
}
